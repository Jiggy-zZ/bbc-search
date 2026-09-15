import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildObjectKey,
  CloudSyncError,
  parsePositiveInteger,
  preflightLocalArtifacts,
} from "../scripts/cloud/common.mjs";
import {
  buildClipRows,
  buildSegmentRows,
  importSelectedCorpus,
} from "../scripts/cloud/import_corpus.mjs";
import { uploadSelectedClips } from "../scripts/cloud/upload_clips.mjs";
import { verifyCloudDataset } from "../scripts/cloud/verify_cloud.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function createFixture(count = 3) {
  const directory = await mkdtemp(join(tmpdir(), "bbc-cloud-"));
  temporaryDirectories.push(directory);
  const clipsDirectory = join(directory, "clips");
  await mkdir(clipsDirectory);

  const segments = Array.from({ length: count }, (_, index) => ({
    sequence: index + 1,
    start_ms: index * 1000,
    end_ms: index * 1000 + 500,
    speaker: null,
    text_en: `Line ${index + 1}`,
    text_zh: `台词 ${index + 1}`,
    normalized_en: `line ${index + 1}`,
    normalized_zh: `台词 ${index + 1}`,
    alignment_confidence: 1,
  }));
  const clips = Array.from({ length: count }, (_, index) => ({
    sequence: index + 1,
    file: `clips/${String(index + 1).padStart(4, "0")}.mp4`,
    clip_start_ms: index * 1000,
    clip_end_ms: index * 1000 + 1000,
    duration_ms: 1000,
  }));
  for (const clip of clips) {
    await writeFile(join(directory, clip.file), "fake mp4");
  }

  const segmentsPath = join(directory, "segments.json");
  const manifestPath = join(directory, "clips_manifest.json");
  await writeFile(
    segmentsPath,
    JSON.stringify({ episode: "tbbt-s01e01", segments }),
  );
  await writeFile(
    manifestPath,
    JSON.stringify({
      episode: "tbbt-s01e01",
      video_duration_ms: 10_000,
      clips,
    }),
  );
  return { directory, segmentsPath, manifestPath, segments, clips };
}

async function preflightFixture(fixture, limit = fixture.segments.length) {
  return preflightLocalArtifacts({
    episode: "tbbt-s01e01",
    segmentsPath: fixture.segmentsPath,
    manifestPath: fixture.manifestPath,
    limit,
  });
}

describe("Phase 4 local contracts", () => {
  it("builds deterministic R2 object keys", () => {
    expect(buildObjectKey("tbbt-s01e01", 1)).toBe("tbbt/s01e01/0001.mp4");
    expect(buildObjectKey("tbbt-s01e01", 100)).toBe(
      "tbbt/s01e01/0100.mp4",
    );
  });

  it("parses only positive integer limits", () => {
    expect(parsePositiveInteger("100", "--limit")).toBe(100);
    expect(() => parsePositiveInteger("0", "--limit")).toThrow(CloudSyncError);
    expect(() => parsePositiveInteger("1.5", "--limit")).toThrow(
      CloudSyncError,
    );
  });

  it("preflight detects a missing local clip", async () => {
    const fixture = await createFixture();
    await unlink(join(fixture.directory, fixture.clips[1].file));
    await expect(preflightFixture(fixture)).rejects.toThrow(
      "missing for sequence 2",
    );
  });

  it("preflight detects a corpus/manifest sequence mismatch", async () => {
    const fixture = await createFixture();
    const manifest = JSON.parse(await readFile(fixture.manifestPath, "utf8"));
    manifest.clips[1].sequence = 9;
    await writeFile(fixture.manifestPath, JSON.stringify(manifest));
    await expect(preflightFixture(fixture)).rejects.toThrow(
      "does not match corpus sequence 2",
    );
  });

  it("preflight selects the first N corpus rows in source order", async () => {
    const fixture = await createFixture(4);
    const result = await preflightFixture(fixture, 2);
    expect(result.segments.map(({ sequence }) => sequence)).toEqual([1, 2]);
    expect(result.clips.map(({ sequence }) => sequence)).toEqual([1, 2]);
  });
});

describe("Phase 4 R2 upload", () => {
  it("dry-run performs HeadObject checks and no PutObject writes", async () => {
    const preflight = await preflightFixture(await createFixture(), 2);
    const commands = [];
    const r2 = {
      async send(command) {
        commands.push(command);
        const error = new Error("missing");
        error.$metadata = { httpStatusCode: 404 };
        throw error;
      },
    };
    const result = await uploadSelectedClips({
      preflight,
      r2,
      bucket: "test-bucket",
      dryRun: true,
    });
    expect(result.wouldUpload).toBe(2);
    expect(commands.every((command) => command instanceof HeadObjectCommand)).toBe(
      true,
    );
    expect(commands.some((command) => command instanceof PutObjectCommand)).toBe(
      false,
    );
  });

  it("skips an existing object by default", async () => {
    const preflight = await preflightFixture(await createFixture(), 1);
    const send = vi.fn().mockResolvedValue({});
    const result = await uploadSelectedClips({
      preflight,
      r2: { send },
      bucket: "test-bucket",
    });
    expect(result).toMatchObject({ uploaded: 0, skipped: 1 });
    expect(send.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand);
  });

  it("overwrite uploads without checking whether the object exists", async () => {
    const preflight = await preflightFixture(await createFixture(), 1);
    const send = vi.fn().mockResolvedValue({});
    const result = await uploadSelectedClips({
      preflight,
      r2: { send },
      bucket: "test-bucket",
      overwrite: true,
    });
    expect(result).toMatchObject({ uploaded: 1, skipped: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBeInstanceOf(PutObjectCommand);
    expect(send.mock.calls[0][0].input.ContentLength).toBeGreaterThan(0);
    expect(send.mock.calls[0][0].input.ContentType).toBe("video/mp4");
  });
});

describe("Phase 4 Supabase import", () => {
  it("maps sequence to source_sequence in segment payloads", () => {
    const rows = buildSegmentRows(
      [
        {
          sequence: 7,
          start_ms: 100,
          end_ms: 200,
          text_en: "Hello",
        },
      ],
      "episode-uuid",
    );
    expect(rows[0]).toMatchObject({
      episode_id: "episode-uuid",
      source_sequence: 7,
      start_ms: 100,
      end_ms: 200,
    });
  });

  it("joins clip rows to the matching Supabase segment UUID", () => {
    const rows = buildClipRows(
      [
        {
          sequence: 2,
          clip_start_ms: 10,
          clip_end_ms: 20,
          duration_ms: 10,
        },
      ],
      new Map([[2, "segment-uuid"]]),
      "tbbt-s01e01",
    );
    expect(rows[0]).toEqual({
      segment_id: "segment-uuid",
      object_key: "tbbt/s01e01/0002.mp4",
      clip_start_ms: 10,
      clip_end_ms: 20,
      duration_ms: 10,
      status: "ready",
    });
  });

  it("import dry-run performs no database writes", async () => {
    const preflight = await preflightFixture(await createFixture(), 2);
    const database = {
      upsertEpisode: vi.fn(),
      upsertSegments: vi.fn(),
      fetchSegmentIds: vi.fn(),
      upsertClips: vi.fn(),
    };
    const result = await importSelectedCorpus({
      preflight,
      metadata: {
        series: "The Big Bang Theory",
        season: 1,
        episodeNumber: 1,
        title: null,
      },
      database,
      dryRun: true,
    });
    expect(result).toEqual({ episodes: 1, segments: 2, clips: 2 });
    expect(database.upsertEpisode).not.toHaveBeenCalled();
    expect(database.upsertSegments).not.toHaveBeenCalled();
    expect(database.upsertClips).not.toHaveBeenCalled();
  });
});

function verificationDatabase(count) {
  const segments = Array.from({ length: count }, (_, index) => ({
    id: `segment-${index + 1}`,
    source_sequence: index + 1,
  }));
  return {
    getEpisodes: vi.fn().mockResolvedValue([{ id: "episode-1" }]),
    getSegments: vi.fn().mockResolvedValue(segments),
    getClips: vi.fn().mockResolvedValue(
      segments.map((segment) => ({
        segment_id: segment.id,
        object_key: buildObjectKey("tbbt-s01e01", segment.source_sequence),
        status: "ready",
      })),
    ),
  };
}

describe("Phase 4 cloud verification", () => {
  it("detects a missing R2 object", async () => {
    const database = verificationDatabase(2);
    const r2 = {
      async send(command) {
        if (command.input.Key.endsWith("0002.mp4")) {
          const error = new Error("missing");
          error.$metadata = { httpStatusCode: 404 };
          throw error;
        }
        return {};
      },
    };
    const report = await verifyCloudDataset({
      episode: "tbbt-s01e01",
      expected: 2,
      database,
      r2,
      bucket: "test-bucket",
    });
    expect(report.passed).toBe(false);
    expect(report.r2Objects).toBe(1);
    expect(report.errors).toContain("Missing R2 object tbbt/s01e01/0002.mp4");
  });

  it("detects a Supabase count mismatch", async () => {
    const database = verificationDatabase(1);
    const r2 = { send: vi.fn().mockResolvedValue({}) };
    const report = await verifyCloudDataset({
      episode: "tbbt-s01e01",
      expected: 2,
      database,
      r2,
      bucket: "test-bucket",
    });
    expect(report.passed).toBe(false);
    expect(report.errors).toContain("Expected 2 dialogue segments, found 1");
    expect(report.errors).toContain("Expected 2 clips, found 1");
  });
});
