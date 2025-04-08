import {
  DevicePixelRatioParam,
  IconMetadata,
  IconSource,
  Services,
  SizeParam,
} from "@/lib/types";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import Redis from "ioredis";
import { blobDigest, sha256 } from "./crypto";
import { Icon, IconImage } from "./types";
import { parseBase64DataURL } from "./url";

function redisCacheKey(key: CacheKey) {
  const { url, size, dpr } = key;
  let host = url.hostname;

  const sizeComponent = () => {
    switch (size) {
      case "favicon":
        return "favicon";
      case "32":
        return `${32 * dpr}`;
      case "64":
        return `${64 * dpr}`;
    }
  };

  // Use | as a separator because it's not a valid character in a URL.
  const contents = [host, sizeComponent()]
    .filter((component) => component != null)
    .join("|");

  return sha256(contents);
}

export async function getCachedImage(
  key: CacheKey,
  redis: Redis
): Promise<IconMetadata | null> {
  if (process.env["RAYCAST_IGNORE_CACHE"] === "true") {
    return null;
  }

  const metadata = await getMetadata(key, redis);
  if (metadata == null) {
    return null;
  }

  const now = new Date();
  if (metadata.expiry < now) {
    const { url } = key;
    await removeFromCache(key, redis);
    return null;
  }

  return metadata;
}

export async function getMetadata(
  key: CacheKey,
  redis: Redis
): Promise<IconMetadata | null> {
  const redisKey = redisCacheKey(key);
  const payload = await redis.hgetall(redisKey);
  if (payload == null) {
    return null;
  }

  try {
    return await IconMetadata.parseAsync(payload);
  } catch (error) {
    await redis.del(redisKey);
    return null;
  }
}

export type CacheKey = {
  url: URL;
  size: SizeParam;
  dpr: DevicePixelRatioParam;
};

export async function setMetadata(
  key: CacheKey,
  metadata: IconMetadata,
  redis: Redis
) {
  const redisKey = redisCacheKey(key);
  await redis.hset(redisKey, metadata);
}

export async function setMetadataPartial(
  key: CacheKey,
  partial: Partial<IconMetadata>,
  redis: Redis
) {
  const redisKey = redisCacheKey(key);
  await redis.hset(redisKey, partial);
}

export async function getStoredObject(key: string, services: Services) {
  const { s3 } = services;
  try {
    const bucket = process.env.RAYCAST_S3_BUCKET_NAME;
    if (bucket == null) {
      return null;
    }
    const { Body, ContentType, ContentLength } = await s3.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );

    // Memory leak in S3 SDK if you don't consume the body; workaround based on:
    // https://github.com/aws/aws-sdk-js-v3/issues/5570#issuecomment-1977613960
    if (Body) {
      const _ = await Body.transformToString();
    }

    return { type: ContentType, size: ContentLength };
  } catch (error) {
    return null;
  }
}

export async function getOrStoreObject(blob: Blob, services: Services) {
  const key = await blobDigest(blob);

  const storedObject = await getStoredObject(key, services);
  if (storedObject != null) {
    return key;
  }

  const { s3Legacy } = services;
  try {
    let arrayBuffer: ArrayBuffer | null = await blob.arrayBuffer();
    let buffer: Buffer | null = Buffer.from(arrayBuffer);
    await new Promise<void>((resolve, reject) => {
      const bucket = process.env.RAYCAST_S3_BUCKET_NAME;
      if (buffer == null || bucket == null) {
        return;
      }
      s3Legacy.putObject(
        {
          Bucket: bucket,
          Key: key,
          ContentType: blob.type,
          Body: buffer,
        },
        (err, data) => {
          arrayBuffer = null;
          buffer = null;
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  } catch (error) {
    return null;
  }

  return key;
}

export async function cacheFavicon(
  key: CacheKey,
  icon: Icon,
  services: Services
) {
  const { image, source } = icon;
  const { expiry } = image;
  const cacheResult = await cacheImage(image, source, services);
  if (cacheResult == null) {
    return;
  }

  const { objectKey } = cacheResult;
  const { redis } = services;
  await setMetadata(
    key,
    {
      objectKey,
      expiry,
      lastAccess: new Date(),
    },
    redis
  );
}

async function cacheImage(
  image: IconImage,
  source: IconSource,
  services: Services
): Promise<{ objectKey: string } | null> {
  if (source.source === "link" && source.data) {
    const parsed = parseBase64DataURL(source.url);
    if (parsed == null) {
      return null;
    }

    const { base64, type } = parsed;
    const buffer = Buffer.from(base64, "base64");
    const blob = new Blob([buffer], { type });
    const objectKey = await getOrStoreObject(blob, services);
    if (objectKey == null) {
      return null;
    }
    return { objectKey };
  } else {
    const { blob } = image;
    const objectKey = await getOrStoreObject(blob, services);
    if (objectKey == null) {
      return null;
    }
    return { objectKey };
  }
}

export async function removeFromCache(key: CacheKey, redis: Redis) {
  // TODO: remove blob if no remaining references.
  const redisKey = redisCacheKey(key);
  await redis.del(redisKey);
}
