import { S3Client } from "@aws-sdk/client-s3";
import S3Legacy from "aws-sdk/clients/s3";
import Redis from "ioredis";
import { z } from "zod";
import { urlSchema } from "./schema";

export type Services = {
  redis: Redis;
  s3: S3Client;
  s3Legacy: S3Legacy;
};

export const allSizes = ["favicon", "32", "64"] as const;
export const SizeParam = z.enum(allSizes);
export type SizeParam = z.infer<typeof SizeParam>;

export const DevicePixelRatioParam = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);
export type DevicePixelRatioParam = z.infer<typeof DevicePixelRatioParam>;

export const LinkIconType = z.union([
  z.literal("apple-touch-icon"),
  z.literal("apple-touch-icon-precomposed"),
  z.literal("shortcut icon"),
  z.literal("icon"),
]);
export type LinkIconType = z.infer<typeof LinkIconType>;

export const IconSize = z.union([
  z.object({ type: z.literal("any") }),
  z.object({
    type: z.literal("single"),
    width: z.number(),
    height: z.number(),
  }),
  z.object({
    type: z.literal("multiple"),
    sizes: z.array(z.object({ width: z.number(), height: z.number() })),
  }),
]);
export type IconSize = z.infer<typeof IconSize>;

const FaviconIconSource = z.object({
  source: z.literal("favicon.ico"),
  url: urlSchema(),
});
const LinkIconSource = z.object({
  source: z.literal("link"),
  type: LinkIconType,
  href: z.string(),
  url: urlSchema(),
  data: z.boolean().optional(), // Is this an inline data reference?
  size: IconSize.optional(),
});
const ManifestIconSource = z.object({
  source: z.literal("manifest"),
  href: z.string(),
  url: urlSchema(),
  size: IconSize.optional(),
});
export type FaviconIconSource = z.infer<typeof FaviconIconSource>;
export type LinkIconSource = z.infer<typeof LinkIconSource>;
export type ManifestIconSource = z.infer<typeof ManifestIconSource>;

export const IconSource = z.union([
  FaviconIconSource,
  LinkIconSource,
  ManifestIconSource,
]);
export type IconSource = z.infer<typeof IconSource>;

export const FoundIcon = z.object({
  image: z.object({
    originURL: z.string().url(),
    cacheURL: z.string().url(),
  }),
  foundIcons: z.array(IconSource),
  expiry: z.string().transform((str) => new Date(str)),
  lastAccess: z.string().transform((str) => new Date(str)),
});
export type FoundIcon = z.infer<typeof FoundIcon>;

// Cached icon metadata.
export const IconMetadata = z.object({
  objectKey: z.string(),
  expiry: z.string().transform((str) => new Date(str)),
  lastAccess: z.string().transform((str) => new Date(str)),
});
export type IconMetadata = z.infer<typeof IconMetadata>;

export const StatsResponse = z.object({
  metadata: z.nullable(FoundIcon),
});
export type StatsResponse = z.infer<typeof StatsResponse>;

export type ReferenceIconSource = LinkIconSource | ManifestIconSource;

export interface IconImage {
  source: URL;
  blob: Blob;
  expiry: Date;
}

export interface Icon {
  image: IconImage;
  source: IconSource;
}
