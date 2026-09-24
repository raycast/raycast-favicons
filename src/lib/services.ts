import { S3Client } from "@aws-sdk/client-s3";
import S3Legacy from "aws-sdk/clients/s3";
import Redis, { RedisOptions } from "ioredis";
import logger from "./logger";
import { Services } from "./types";

export function connectServices(): Services {
  const redisURL = process.env.REDIS_URL as string;
  // Log the host only: the URL carries the Redis password.
  logger.info(`Connecting to redis at '${redactedHost(redisURL)}'`);

  const options: RedisOptions =
    process.env.NODE_ENV === "development"
      ? {}
      : {
          tls: {
            rejectUnauthorized: false,
          },
        };

  const redis = new Redis(redisURL, options);

  const s3Region = process.env.RAYCAST_S3_REGION;
  logger.info(`Connecting to S3 at ${s3Region}...`);
  const s3 = new S3Client({ region: s3Region });
  const s3Legacy = new S3Legacy({ region: s3Region });

  return { redis, s3, s3Legacy };
}

function redactedHost(url: string | undefined) {
  try {
    const { protocol, host } = new URL(url ?? "");
    return `${protocol}//${host}`;
  } catch {
    return "(unparseable REDIS_URL)";
  }
}
