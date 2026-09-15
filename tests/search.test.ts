import { describe, expect, it, vi } from "vitest";

import { createSearchHandler } from "@/app/api/search/route";
import {
  normalizeChineseSearchText,
  normalizeEnglishSearchText,
  normalizeSearchQuery,
} from "@/lib/search/normalize";
import { rankMatch, sortSearchResults } from "@/lib/search/rank";
import type {
  RankedSearchCandidate,
  SearchDatabaseCandidate,
} from "@/lib/search/types";

function databaseCandidate(
  overrides: Partial<SearchDatabaseCandidate> = {},
): SearchDatabaseCandidate {
  return {
    id: "segment-1",
    source_sequence: 1,
    speaker: null,
    start_ms: 2380,
    text_en: "So if a photon is directed through a plane",
    text_zh: "如果一个光子打向有两个狭缝的平面",
    normalized_en: "so if a photon is directed through a plane",
    normalized_zh: "如果一个光子打向有两个狭缝的平面",
    episodes: { season: 1, episode: 1 },
    clips: { id: "clip-1", status: "ready" },
    ...overrides,
  };
}

function rankedCandidate(
  sourceSequence: number,
  normalizedEn: string | null,
  normalizedZh: string | null = null,
): RankedSearchCandidate {
  return {
    segmentId: `segment-${sourceSequence}`,
    clipId: `clip-${sourceSequence}`,
    episode: "S01E01",
    sourceSequence,
    speaker: null,
    startMs: sourceSequence * 1000,
    textEn: normalizedEn,
    textZh: normalizedZh,
    normalizedEn,
    normalizedZh,
  };
}

describe("search normalization", () => {
  it("lowercases English, collapses whitespace, and normalizes apostrophes", () => {
    expect(normalizeEnglishSearchText("  I’m   CRAZY  ")).toBe("i'm crazy");
    expect(normalizeSearchQuery("  IʼM\tCRAZY ")).toBe("i'm crazy");
  });

  it("collapses Chinese whitespace without changing its text", () => {
    expect(normalizeChineseSearchText("  如果  一个\n光子  ")).toBe(
      "如果 一个 光子",
    );
  });
});

describe("search ranking", () => {
  it("ranks exact before starts-with before contains", () => {
    expect(rankMatch("photon", "photon")).toBe(0);
    expect(rankMatch("photon beam", "photon")).toBe(1);
    expect(rankMatch("a photon beam", "photon")).toBe(2);
    expect(rankMatch("electron", "photon")).toBeNull();
  });

  it("uses the better English or Chinese rank", () => {
    const results = sortSearchResults(
      [
        rankedCandidate(1, "contains 光子 here", "光子"),
        rankedCandidate(2, "光子 starts here", null),
      ],
      "光子",
    );
    expect(results.map(({ sourceSequence }) => sourceSequence)).toEqual([1, 2]);
  });

  it("breaks equal-rank ties by sourceSequence", () => {
    const results = sortSearchResults(
      [rankedCandidate(9, "a photon"), rankedCandidate(3, "the photon")],
      "photon",
    );
    expect(results.map(({ sourceSequence }) => sourceSequence)).toEqual([3, 9]);
  });
});

describe("GET /api/search", () => {
  it.each([
    ["missing q", "http://localhost/api/search"],
    ["whitespace only", "http://localhost/api/search?q=%20%20"],
    ["one normalized character", "http://localhost/api/search?q=%20a%20"],
    ["more than 100 normalized characters", `http://localhost/api/search?q=${"a".repeat(101)}`],
  ])("returns 400 for %s", async (_name, url) => {
    const fetchCandidates = vi.fn();
    const response = await createSearchHandler(fetchCandidates)(new Request(url));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_query" });
    expect(fetchCandidates).not.toHaveBeenCalled();
  });

  it("returns a normalized English match with the public response shape", async () => {
    const fetchCandidates = vi.fn().mockResolvedValue([
      {
        ...databaseCandidate(),
        object_key: "must-not-leak.mp4",
      },
    ]);
    const response = await createSearchHandler(fetchCandidates)(
      new Request("http://localhost/api/search?q=%20PHOTON%20"),
    );
    expect(response.status).toBe(200);
    expect(fetchCandidates).toHaveBeenCalledWith("photon");
    expect(await response.json()).toEqual({
      query: "photon",
      count: 1,
      results: [
        {
          segmentId: "segment-1",
          clipId: "clip-1",
          episode: "S01E01",
          sourceSequence: 1,
          speaker: null,
          startMs: 2380,
          textEn: "So if a photon is directed through a plane",
          textZh: "如果一个光子打向有两个狭缝的平面",
        },
      ],
    });
  });

  it("returns a Chinese match", async () => {
    const response = await createSearchHandler(
      vi.fn().mockResolvedValue([databaseCandidate()]),
    )(new Request("http://localhost/api/search?q=光子"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.count).toBe(1);
    expect(body.results[0].textZh).toContain("光子");
  });

  it("returns 200 with an empty result for a valid non-match", async () => {
    const response = await createSearchHandler(vi.fn().mockResolvedValue([]))(
      new Request("http://localhost/api/search?q=craxy"),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      query: "craxy",
      count: 0,
      results: [],
    });
  });

  it("excludes candidates with a missing or non-ready clip", async () => {
    const response = await createSearchHandler(
      vi.fn().mockResolvedValue([
        databaseCandidate({ clips: [] }),
        databaseCandidate({
          id: "segment-2",
          source_sequence: 2,
          clips: { id: "clip-2", status: "missing" },
        }),
      ]),
    )(new Request("http://localhost/api/search?q=photon"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ count: 0, results: [] });
  });

  it("returns at most 50 results after deterministic ranking", async () => {
    const candidates = Array.from({ length: 60 }, (_, index) => {
      const sequence = 60 - index;
      return databaseCandidate({
        id: `segment-${sequence}`,
        source_sequence: sequence,
        normalized_en: `a photon ${sequence}`,
        text_en: `A photon ${sequence}`,
        clips: { id: `clip-${sequence}`, status: "ready" },
      });
    });
    const response = await createSearchHandler(
      vi.fn().mockResolvedValue(candidates),
    )(new Request("http://localhost/api/search?q=photon"));
    const body = await response.json();
    expect(body.count).toBe(50);
    expect(body.results[0].sourceSequence).toBe(1);
    expect(body.results[49].sourceSequence).toBe(50);
  });

  it("returns a sanitized 500 when Supabase fails", async () => {
    const providerError = new Error("secret provider connection detail");
    providerError.name = "ProviderError";
    const logError = vi.fn();
    const response = await createSearchHandler(
      vi.fn().mockRejectedValue(providerError),
      logError,
    )(new Request("http://localhost/api/search?q=photon"));
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ error: "search_failed" });
    expect(logError).toHaveBeenCalledWith("Search failed: ProviderError");
    expect(body).not.toContain("secret provider connection detail");
  });
});
