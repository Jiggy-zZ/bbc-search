import "server-only";

import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";

import { getServerEnv } from "@/lib/env";

let client: S3Client | undefined;

export function getR2Client(): S3Client {
  if (!client) {
    const env = getServerEnv();

    client = new S3Client({
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      region: "auto",
    });
  }

  return client;
}

export async function probeStorage(): Promise<void> {
  const env = getServerEnv();

  await getR2Client().send(
    new HeadBucketCommand({
      Bucket: env.R2_BUCKET_NAME,
    }),
  );
}
