import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";

import {
  buildObjectKey,
  CloudSyncError,
  DEFAULT_LIMIT,
  isNotFoundError,
  loadEnvLocal,
  parsePositiveInteger,
  R2_ENV_NAMES,
  serviceError,
  SUPABASE_ENV_NAMES,
} from "./common.mjs";
import { createR2Client } from "./upload_clips.mjs";

function throwIfSupabaseError(label, error) {
  if (error) {
    throw serviceError(label, error);
  }
}

export function createSupabaseReader(client) {
  return Object.freeze({
    async getEpisodes(slug) {
      const { data, error } = await client
        .from("episodes")
        .select("id,slug")
        .eq("slug", slug);
      throwIfSupabaseError("Supabase episode verification query", error);
      return data ?? [];
    },

    async getSegments(episodeId, expected) {
      const { data, error } = await client
        .from("dialogue_segments")
        .select("id,source_sequence")
        .eq("episode_id", episodeId)
        .gte("source_sequence", 1)
        .lte("source_sequence", expected);
      throwIfSupabaseError("Supabase segment verification query", error);
      return data ?? [];
    },

    async getClips(segmentIds) {
      if (segmentIds.length === 0) {
        return [];
      }
      const { data, error } = await client
        .from("clips")
        .select("segment_id,object_key,status")
        .in("segment_id", segmentIds);
      throwIfSupabaseError("Supabase clip verification query", error);
      return data ?? [];
    },
  });
}

async function verifyR2Objects(r2, bucket, keys) {
  let present = 0;
  const missing = [];

  // Keep the verification read-only and avoid sending all 100 requests at once.
  for (let offset = 0; offset < keys.length; offset += 10) {
    const batch = keys.slice(offset, offset + 10);
    const results = await Promise.all(
      batch.map(async (key) => {
        try {
          await r2.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
          return { key, present: true };
        } catch (error) {
          if (isNotFoundError(error)) {
            return { key, present: false };
          }
          throw serviceError(`R2 HeadObject for ${key}`, error);
        }
      }),
    );
    for (const result of results) {
      if (result.present) {
        present += 1;
      } else {
        missing.push(result.key);
      }
    }
  }
  return { present, missing };
}

export async function verifyCloudDataset({
  episode,
  expected,
  database,
  r2,
  bucket,
}) {
  const safeExpected = parsePositiveInteger(expected, "--expected");
  const errors = [];
  const expectedSequences = Array.from(
    { length: safeExpected },
    (_, index) => index + 1,
  );
  const expectedKeys = expectedSequences.map((sequence) =>
    buildObjectKey(episode, sequence),
  );

  const episodes = await database.getEpisodes(episode);
  if (episodes.length !== 1) {
    errors.push(`Expected 1 episode row, found ${episodes.length}`);
  }

  const segments =
    episodes.length === 1
      ? await database.getSegments(episodes[0].id, safeExpected)
      : [];
  if (segments.length !== safeExpected) {
    errors.push(
      `Expected ${safeExpected} dialogue segments, found ${segments.length}`,
    );
  }

  const sequenceToId = new Map();
  const idToSequence = new Map();
  for (const segment of segments) {
    if (!Number.isSafeInteger(segment.source_sequence)) {
      errors.push("A dialogue segment has an invalid source_sequence");
      continue;
    }
    if (sequenceToId.has(segment.source_sequence)) {
      errors.push(`Duplicate source_sequence ${segment.source_sequence}`);
      continue;
    }
    sequenceToId.set(segment.source_sequence, segment.id);
    idToSequence.set(segment.id, segment.source_sequence);
  }
  for (const sequence of expectedSequences) {
    if (!sequenceToId.has(sequence)) {
      errors.push(`Missing dialogue segment source_sequence ${sequence}`);
    }
  }

  const clips = await database.getClips([...idToSequence.keys()]);
  if (clips.length !== safeExpected) {
    errors.push(`Expected ${safeExpected} clips, found ${clips.length}`);
  }
  const clipsBySegment = new Map();
  for (const clip of clips) {
    if (clipsBySegment.has(clip.segment_id)) {
      errors.push(`Segment ${clip.segment_id} has more than one clip`);
      continue;
    }
    clipsBySegment.set(clip.segment_id, clip);
    const sequence = idToSequence.get(clip.segment_id);
    if (!sequence) {
      errors.push(`Clip references an unexpected segment ${clip.segment_id}`);
      continue;
    }
    if (clip.status !== "ready") {
      errors.push(`Clip for source_sequence ${sequence} is not ready`);
    }
    const expectedKey = buildObjectKey(episode, sequence);
    if (clip.object_key !== expectedKey) {
      errors.push(`Clip for source_sequence ${sequence} has an unexpected object key`);
    }
  }
  for (const [segmentId, sequence] of idToSequence) {
    if (!clipsBySegment.has(segmentId)) {
      errors.push(`Missing clip for source_sequence ${sequence}`);
    }
  }

  const r2Result = await verifyR2Objects(r2, bucket, expectedKeys);
  for (const key of r2Result.missing) {
    errors.push(`Missing R2 object ${key}`);
  }

  return Object.freeze({
    episode,
    expected: safeExpected,
    segments: segments.length,
    clips: clips.length,
    r2Objects: r2Result.present,
    errors,
    passed: errors.length === 0,
  });
}

export function parseVerifyArguments(argv) {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    strict: true,
    options: {
      episode: { type: "string" },
      expected: { type: "string", default: String(DEFAULT_LIMIT) },
    },
  });
  if (!values.episode) {
    throw new CloudSyncError("--episode is required");
  }
  return Object.freeze({
    episode: values.episode,
    expected: parsePositiveInteger(values.expected, "--expected"),
  });
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseVerifyArguments(argv);
  const env = await loadEnvLocal({
    required: [...SUPABASE_ENV_NAMES, ...R2_ENV_NAMES],
  });
  const supabase = createClient(
    env.SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );
  const report = await verifyCloudDataset({
    episode: args.episode,
    expected: args.expected,
    database: createSupabaseReader(supabase),
    r2: createR2Client(env),
    bucket: env.R2_BUCKET_NAME,
  });

  console.log(`Episode: ${report.episode}`);
  console.log(`Expected: ${report.expected}`);
  console.log(`Supabase segments: ${report.segments}`);
  console.log(`Supabase clips: ${report.clips}`);
  console.log(`R2 objects present: ${report.r2Objects}`);
  console.log(`Result: ${report.passed ? "PASS" : "FAIL"}`);
  for (const error of report.errors) {
    console.error(`- ${error}`);
  }
  if (!report.passed) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown cloud sync error";
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  });
}
