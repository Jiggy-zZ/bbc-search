import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { createClient } from "@supabase/supabase-js";

import {
  buildObjectKey,
  CloudSyncError,
  DEFAULT_LIMIT,
  loadEnvLocal,
  parsePositiveInteger,
  preflightLocalArtifacts,
  serviceError,
  SUPABASE_ENV_NAMES,
} from "./common.mjs";

function nullable(value) {
  return value ?? null;
}

export function buildSegmentRows(segments, episodeId) {
  return segments.map((segment) => ({
    episode_id: episodeId,
    source_sequence: segment.sequence,
    start_ms: segment.start_ms,
    end_ms: segment.end_ms,
    speaker: nullable(segment.speaker),
    text_en: nullable(segment.text_en),
    text_zh: nullable(segment.text_zh),
    normalized_en: nullable(segment.normalized_en),
    normalized_zh: nullable(segment.normalized_zh),
    alignment_confidence: nullable(segment.alignment_confidence),
  }));
}

export function buildClipRows(clips, segmentIds, episode) {
  return clips.map((clip) => {
    const segmentId = segmentIds.get(clip.sequence);
    if (!segmentId) {
      throw new CloudSyncError(
        `Supabase did not return an ID for source_sequence ${clip.sequence}`,
      );
    }
    return {
      segment_id: segmentId,
      object_key: buildObjectKey(episode, clip.sequence),
      clip_start_ms: clip.clip_start_ms,
      clip_end_ms: clip.clip_end_ms,
      duration_ms: clip.duration_ms,
      status: "ready",
    };
  });
}

function throwIfSupabaseError(label, error) {
  if (error) {
    throw serviceError(label, error);
  }
}

export function createSupabaseDatabase(client) {
  return Object.freeze({
    async upsertEpisode(payload) {
      const { data, error } = await client
        .from("episodes")
        .upsert(payload, { onConflict: "slug" })
        .select("id")
        .single();
      throwIfSupabaseError("Supabase episode upsert", error);
      if (!data?.id) {
        throw new CloudSyncError("Supabase episode upsert returned no ID");
      }
      return data.id;
    },

    async upsertSegments(rows) {
      const { error } = await client.from("dialogue_segments").upsert(rows, {
        onConflict: "episode_id,source_sequence",
      });
      throwIfSupabaseError("Supabase segment upsert", error);
    },

    async fetchSegmentIds(episodeId, sequences) {
      const { data, error } = await client
        .from("dialogue_segments")
        .select("id,source_sequence")
        .eq("episode_id", episodeId)
        .in("source_sequence", sequences);
      throwIfSupabaseError("Supabase segment ID query", error);

      const mapping = new Map();
      for (const row of data ?? []) {
        if (!Number.isSafeInteger(row.source_sequence) || !row.id) {
          throw new CloudSyncError("Supabase returned an invalid segment ID row");
        }
        if (mapping.has(row.source_sequence)) {
          throw new CloudSyncError(
            `Supabase returned duplicate source_sequence ${row.source_sequence}`,
          );
        }
        mapping.set(row.source_sequence, row.id);
      }
      return mapping;
    },

    async upsertClips(rows) {
      const { error } = await client
        .from("clips")
        .upsert(rows, { onConflict: "segment_id" });
      throwIfSupabaseError("Supabase clip upsert", error);
    },
  });
}

function validateMetadata(metadata) {
  if (!metadata.series.trim()) {
    throw new CloudSyncError("--series must not be empty");
  }
  if (metadata.title !== null && !metadata.title.trim()) {
    throw new CloudSyncError("--title must not be empty when supplied");
  }
}

export async function importSelectedCorpus({
  preflight,
  metadata,
  database,
  dryRun = false,
}) {
  validateMetadata(metadata);
  if (dryRun) {
    return Object.freeze({
      episodes: 1,
      segments: preflight.segments.length,
      clips: preflight.clips.length,
    });
  }
  if (!database) {
    throw new CloudSyncError("A Supabase database adapter is required");
  }

  const episodeId = await database.upsertEpisode({
    slug: preflight.episode,
    series: metadata.series,
    season: metadata.season,
    episode: metadata.episodeNumber,
    title: metadata.title,
    duration_ms: preflight.videoDurationMs,
  });
  const segmentRows = buildSegmentRows(preflight.segments, episodeId);
  await database.upsertSegments(segmentRows);

  const sequences = preflight.segments.map(({ sequence }) => sequence);
  const segmentIds = await database.fetchSegmentIds(episodeId, sequences);
  if (segmentIds.size !== preflight.segments.length) {
    throw new CloudSyncError(
      `Supabase returned ${segmentIds.size} selected segments; expected ${preflight.segments.length}`,
    );
  }

  const clipRows = buildClipRows(preflight.clips, segmentIds, preflight.episode);
  await database.upsertClips(clipRows);
  return Object.freeze({ episodes: 1, segments: segmentRows.length, clips: clipRows.length });
}

export function parseImportArguments(argv) {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    strict: true,
    options: {
      episode: { type: "string" },
      series: { type: "string" },
      season: { type: "string" },
      "episode-number": { type: "string" },
      title: { type: "string" },
      segments: { type: "string" },
      manifest: { type: "string" },
      limit: { type: "string", default: String(DEFAULT_LIMIT) },
      "dry-run": { type: "boolean", default: false },
    },
  });
  const required = ["episode", "series", "season", "episode-number", "segments", "manifest"];
  const missing = required.filter((name) => !values[name]);
  if (missing.length > 0) {
    throw new CloudSyncError(`Missing required option(s): ${missing.map((name) => `--${name}`).join(", ")}`);
  }

  return Object.freeze({
    episode: values.episode,
    series: values.series,
    season: parsePositiveInteger(values.season, "--season"),
    episodeNumber: parsePositiveInteger(values["episode-number"], "--episode-number"),
    title: values.title ?? null,
    segmentsPath: resolve(values.segments),
    manifestPath: resolve(values.manifest),
    limit: parsePositiveInteger(values.limit, "--limit"),
    dryRun: values["dry-run"],
  });
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseImportArguments(argv);
  const preflight = await preflightLocalArtifacts(args);
  const metadata = {
    series: args.series,
    season: args.season,
    episodeNumber: args.episodeNumber,
    title: args.title,
  };

  let database;
  if (!args.dryRun) {
    const env = await loadEnvLocal({ required: SUPABASE_ENV_NAMES });
    const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
    database = createSupabaseDatabase(client);
  }

  const result = await importSelectedCorpus({
    preflight,
    metadata,
    database,
    dryRun: args.dryRun,
  });
  if (args.dryRun) {
    console.log("Would upsert:");
  } else {
    console.log("Upserted:");
  }
  console.log(`${result.episodes} episode`);
  console.log(`${result.segments} segments`);
  console.log(`${result.clips} clips`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown cloud sync error";
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  });
}
