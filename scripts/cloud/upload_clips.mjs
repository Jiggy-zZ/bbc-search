import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import {
  buildObjectKey,
  CloudSyncError,
  DEFAULT_LIMIT,
  defaultSegmentsPath,
  isNotFoundError,
  loadEnvLocal,
  parsePositiveInteger,
  preflightLocalArtifacts,
  R2_ENV_NAMES,
  serviceError,
} from "./common.mjs";

export function createR2Client(env) {
  return new S3Client({
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    region: "auto",
  });
}

async function objectExists(r2, bucket, key) {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }
    throw serviceError(`R2 HeadObject for ${key}`, error);
  }
}

export async function uploadSelectedClips({
  preflight,
  r2,
  bucket,
  dryRun = false,
  overwrite = false,
}) {
  const actions = [];
  let uploaded = 0;
  let skipped = 0;

  for (const clip of preflight.clips) {
    const key = buildObjectKey(preflight.episode, clip.sequence);
    const exists = overwrite ? false : await objectExists(r2, bucket, key);

    if (exists) {
      skipped += 1;
      actions.push({ action: "SKIP", key, sequence: clip.sequence });
      continue;
    }
    if (dryRun) {
      actions.push({ action: "WOULD_UPLOAD", key, sequence: clip.sequence });
      continue;
    }

    try {
      await r2.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: createReadStream(clip.path),
          ContentLength: clip.size,
          ContentType: "video/mp4",
        }),
      );
    } catch (error) {
      throw serviceError(`R2 PutObject for ${key}`, error);
    }
    uploaded += 1;
    actions.push({ action: "UPLOAD", key, sequence: clip.sequence });
  }

  return Object.freeze({
    selected: preflight.clips.length,
    uploaded,
    skipped,
    wouldUpload: actions.filter(({ action }) => action === "WOULD_UPLOAD").length,
    actions,
  });
}

export function parseUploadArguments(argv) {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    strict: true,
    options: {
      episode: { type: "string" },
      manifest: { type: "string" },
      segments: { type: "string" },
      limit: { type: "string", default: String(DEFAULT_LIMIT) },
      "dry-run": { type: "boolean", default: false },
      overwrite: { type: "boolean", default: false },
    },
  });
  if (!values.episode || !values.manifest) {
    throw new CloudSyncError("--episode and --manifest are required");
  }

  const manifestPath = resolve(values.manifest);
  return Object.freeze({
    episode: values.episode,
    manifestPath,
    segmentsPath: values.segments
      ? resolve(values.segments)
      : defaultSegmentsPath(manifestPath),
    limit: parsePositiveInteger(values.limit, "--limit"),
    dryRun: values["dry-run"],
    overwrite: values.overwrite,
  });
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseUploadArguments(argv);

  // Complete every local check before loading a cloud client or issuing a
  // cloud request. This guarantees that local preflight failures write nothing.
  const preflight = await preflightLocalArtifacts(args);
  const env = await loadEnvLocal({ required: R2_ENV_NAMES });
  const r2 = createR2Client(env);
  const result = await uploadSelectedClips({
    preflight,
    r2,
    bucket: env.R2_BUCKET_NAME,
    dryRun: args.dryRun,
    overwrite: args.overwrite,
  });

  for (const action of result.actions) {
    console.log(`${action.action}: ${action.key}`);
  }
  console.log(`Episode: ${args.episode}`);
  console.log(`Selected: ${result.selected}`);
  if (args.dryRun) {
    console.log(`Would upload: ${result.wouldUpload}`);
    console.log(`Would skip: ${result.skipped}`);
  } else {
    console.log(`Uploaded: ${result.uploaded}`);
    console.log(`Skipped: ${result.skipped}`);
    console.log("Failed: 0");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown cloud sync error";
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  });
}
