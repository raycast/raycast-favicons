import { S3Client } from "@aws-sdk/client-s3";
import S3Legacy from "aws-sdk/clients/s3";
import Redis, { RedisOptions } from "ioredis";
import logger from "./logger";
import { Services } from "./types";

export function connectServices(): Services {
  const redisURL = process.env.REDIS_URL;
  let redis: Redis | null = null;
  
  if (redisURL) {
    logger.info(`Connecting to redis at '${redisURL}'`);
    const options: RedisOptions =
      process.env.NODE_ENV === "development"
        ? {}
        : {
            tls: {
              rejectUnauthorized: false,
            },
          };
    
    try {
      redis = new Redis(redisURL, options);
    } catch (error) {
      logger.warn('Redis connection failed, running without cache', error);
    }
  } else {
    logger.warn('No REDIS_URL provided, running without cache');
  }

  const s3Region = process.env.RAYCAST_S3_REGION || process.env.AWS_REGION;
  logger.info(`Connecting to S3 at ${s3Region}...`);
  const s3 = new S3Client({ region: s3Region });
  const s3Legacy = new S3Legacy({ region: s3Region });

  return { redis: redis as any, s3, s3Legacy };
}
