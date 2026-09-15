import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export const DEFAULT_LIMIT = 100;

export const R2_ENV_NAMES = Object.freeze([
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
]);

export const SUPABASE_ENV_NAMES = Object.freeze([
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
]);

export class CloudSyncError extends Error {
  constructor(message) {
    super(message);
    this.name = "CloudSyncError";
  }
}

export function parsePositiveInteger(value, optionName) {
  if (!/^\d+$/.test(String(value))) {
    throw new CloudSyncError(`${optionName} must be a positive integer`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new CloudSyncError(`${optionName} must be a positive integer`);
  }
  return parsed;
}

export function parseEpisodeSlug(episode) {
  const match = /^([a-z0-9]+)-s(\d{2})e(\d{2})$/.exec(episode);
  if (!match) {
    throw new CloudSyncError(
      `Invalid episode slug ${JSON.stringify(episode)}; expected e.g. tbbt-s01e01`,
    );
  }
  return Object.freeze({
    seriesSlug: match[1],
    season: Number(match[2]),
    episode: Number(match[3]),
  });
}

export function buildObjectKey(episode, sequence) {
  const parsed = parseEpisodeSlug(episode);
  const safeSequence = parsePositiveInteger(sequence, "sequence");
  if (safeSequence > 9999) {
    throw new CloudSyncError("sequence must not exceed 9999");
  }
  return `${parsed.seriesSlug}/s${String(parsed.season).padStart(2, "0")}e${String(parsed.episode).padStart(2, "0")}/${String(safeSequence).padStart(4, "0")}.mp4`;
}

function parseEnvText(text) {
  const values = {};
  for (const [index, originalLine] of text.split(/\r?\n/u).entries()) {
    const line = originalLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(
      line,
    );
    if (!match) {
      throw new CloudSyncError(
        `.env.local line ${index + 1} must use NAME=value syntax`,
      );
    }

    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

export async function loadEnvLocal({
  path = resolve(".env.local"),
  required,
  environment = process.env,
}) {
  let fileValues;
  try {
    fileValues = parseEnvText(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof CloudSyncError) {
      throw error;
    }
    throw new CloudSyncError(`Unable to read .env.local at ${path}`);
  }

  const values = {};
  const missing = [];
  for (const name of required) {
    const value = environment[name]?.trim() || fileValues[name]?.trim();
    if (!value) {
      missing.push(name);
    } else {
      values[name] = value;
    }
  }

  if (missing.length > 0) {
    throw new CloudSyncError(
      `Missing required environment variable${missing.length === 1 ? "" : "s"} in .env.local: ${missing.join(", ")}`,
    );
  }
  return Object.freeze(values);
}

export async function loadJson(path, label) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new CloudSyncError(`${label} is not valid JSON: ${path}`);
    }
    throw new CloudSyncError(`Unable to read ${label}: ${path}`);
  }
}

function isInteger(value) {
  return Number.isSafeInteger(value);
}

function validateOptionalString(value, field, sequence) {
  if (value !== null && value !== undefined && typeof value !== "string") {
    throw new CloudSyncError(
      `Segment ${sequence} field ${field} must be a string or null`,
    );
  }
}

function validateSegment(segment, index, seenSequences) {
  if (!segment || typeof segment !== "object" || Array.isArray(segment)) {
    throw new CloudSyncError(`Corpus segment #${index + 1} must be an object`);
  }

  const { sequence, start_ms: startMs, end_ms: endMs } = segment;
  if (!isInteger(sequence) || sequence <= 0) {
    throw new CloudSyncError(
      `Corpus segment #${index + 1} must have a positive integer sequence`,
    );
  }
  if (seenSequences.has(sequence)) {
    throw new CloudSyncError(`Corpus sequence ${sequence} is duplicated`);
  }
  seenSequences.add(sequence);
  if (sequence !== index + 1) {
    throw new CloudSyncError(
      `Selected corpus sequence ${sequence} does not match expected source order ${index + 1}`,
    );
  }
  if (!isInteger(startMs) || startMs < 0 || !isInteger(endMs) || endMs <= startMs) {
    throw new CloudSyncError(`Corpus segment ${sequence} has invalid timing`);
  }

  for (const field of [
    "speaker",
    "text_en",
    "text_zh",
    "normalized_en",
    "normalized_zh",
  ]) {
    validateOptionalString(segment[field], field, sequence);
  }
  if (!segment.text_en?.trim() && !segment.text_zh?.trim()) {
    throw new CloudSyncError(`Corpus segment ${sequence} has no dialogue text`);
  }
  const confidence = segment.alignment_confidence;
  if (
    confidence !== null &&
    confidence !== undefined &&
    (typeof confidence !== "number" || confidence < 0 || confidence > 1)
  ) {
    throw new CloudSyncError(
      `Corpus segment ${sequence} has invalid alignment_confidence`,
    );
  }
}

function validateClip(clip, index, expectedSequence, seenSequences) {
  if (!clip || typeof clip !== "object" || Array.isArray(clip)) {
    throw new CloudSyncError(`Clip manifest entry #${index + 1} must be an object`);
  }

  const sequence = clip.sequence;
  if (!isInteger(sequence) || sequence <= 0) {
    throw new CloudSyncError(
      `Clip manifest entry #${index + 1} must have a positive integer sequence`,
    );
  }
  if (seenSequences.has(sequence)) {
    throw new CloudSyncError(`Clip sequence ${sequence} is duplicated`);
  }
  seenSequences.add(sequence);
  if (sequence !== expectedSequence) {
    throw new CloudSyncError(
      `Clip sequence ${sequence} does not match corpus sequence ${expectedSequence}`,
    );
  }

  const start = clip.clip_start_ms;
  const end = clip.clip_end_ms;
  const duration = clip.duration_ms;
  if (
    !isInteger(start) ||
    start < 0 ||
    !isInteger(end) ||
    end <= start ||
    !isInteger(duration) ||
    duration <= 0 ||
    duration !== end - start
  ) {
    throw new CloudSyncError(`Clip ${sequence} has invalid timing`);
  }
  if (typeof clip.file !== "string" || !clip.file.trim()) {
    throw new CloudSyncError(`Clip ${sequence} must reference a local file`);
  }
}

function resolveClipPath(manifestPath, file, sequence) {
  if (isAbsolute(file)) {
    throw new CloudSyncError(`Clip ${sequence} file must be relative to its manifest`);
  }
  const manifestDirectory = resolve(dirname(manifestPath));
  const clipPath = resolve(manifestDirectory, file);
  const relativePath = relative(manifestDirectory, clipPath);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new CloudSyncError(`Clip ${sequence} file escapes the manifest directory`);
  }
  return clipPath;
}

export async function preflightLocalArtifacts({
  episode,
  segmentsPath,
  manifestPath,
  limit = DEFAULT_LIMIT,
}) {
  parseEpisodeSlug(episode);
  const safeLimit = parsePositiveInteger(limit, "--limit");
  const [corpus, manifest] = await Promise.all([
    loadJson(segmentsPath, "segments JSON"),
    loadJson(manifestPath, "clips manifest"),
  ]);

  if (corpus?.episode !== episode) {
    throw new CloudSyncError(`Corpus episode does not match --episode ${episode}`);
  }
  if (!Array.isArray(corpus.segments) || corpus.segments.length === 0) {
    throw new CloudSyncError("Corpus must contain a non-empty segments array");
  }
  if (corpus.segments.length < safeLimit) {
    throw new CloudSyncError(
      `Corpus contains ${corpus.segments.length} segments, fewer than --limit ${safeLimit}`,
    );
  }
  if (manifest?.episode !== episode) {
    throw new CloudSyncError(
      `Clips manifest episode does not match --episode ${episode}`,
    );
  }
  if (!Array.isArray(manifest.clips) || manifest.clips.length < safeLimit) {
    throw new CloudSyncError(
      `Clips manifest contains ${Array.isArray(manifest?.clips) ? manifest.clips.length : 0} entries, fewer than --limit ${safeLimit}`,
    );
  }
  if (!isInteger(manifest.video_duration_ms) || manifest.video_duration_ms <= 0) {
    throw new CloudSyncError("Clips manifest has invalid video_duration_ms");
  }

  const selectedSegments = corpus.segments.slice(0, safeLimit);
  const selectedClips = manifest.clips.slice(0, safeLimit);
  const segmentSequences = new Set();
  const clipSequences = new Set();
  const clips = [];

  for (const [index, segment] of selectedSegments.entries()) {
    validateSegment(segment, index, segmentSequences);
  }
  for (const [index, clip] of selectedClips.entries()) {
    validateClip(clip, index, selectedSegments[index].sequence, clipSequences);
    const path = resolveClipPath(manifestPath, clip.file, clip.sequence);
    clips.push({ ...clip, path });
  }

  const clipsWithStats = await Promise.all(
    clips.map(async (clip) => {
      let details;
      try {
        details = await stat(clip.path);
      } catch {
        throw new CloudSyncError(
          `Local clip file is missing for sequence ${clip.sequence}: ${clip.path}`,
        );
      }
      if (!details.isFile() || details.size <= 0) {
        throw new CloudSyncError(
          `Local clip file is empty or invalid for sequence ${clip.sequence}: ${clip.path}`,
        );
      }
      return { ...clip, size: details.size };
    }),
  );

  return Object.freeze({
    episode,
    limit: safeLimit,
    segments: selectedSegments,
    clips: clipsWithStats,
    videoDurationMs: manifest.video_duration_ms,
  });
}

export function defaultSegmentsPath(manifestPath) {
  return resolve(dirname(manifestPath), "segments.json");
}

export function isNotFoundError(error) {
  return (
    error?.$metadata?.httpStatusCode === 404 ||
    error?.name === "NotFound" ||
    error?.name === "NoSuchKey"
  );
}

export function serviceError(label, error) {
  const identifier =
    typeof error?.code === "string"
      ? error.code
      : typeof error?.name === "string"
        ? error.name
        : "UnknownError";
  return new CloudSyncError(`${label} failed (${identifier})`);
}
