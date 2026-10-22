import { S3Client } from '@aws-sdk/client-s3';
import { Global, Module } from '@nestjs/common';
import { ENV, type Env } from '../config/env.js';

export const S3 = Symbol('S3');

@Global()
@Module({
  providers: [
    {
      provide: S3,
      inject: [ENV],
      useFactory: (env: Env) =>
        new S3Client({
          endpoint: env.S3_ENDPOINT,
          region: env.S3_REGION,
          credentials: {
            accessKeyId: env.S3_ACCESS_KEY,
            secretAccessKey: env.S3_SECRET_KEY,
          },
          // SeaweedFS and MinIO serve buckets as paths, not as bucket.host names.
          forcePathStyle: true,
        }),
    },
  ],
  exports: [S3],
})
export class S3Module {}
