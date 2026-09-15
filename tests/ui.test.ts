import { describe, expect, it } from "vitest";

import { formatTime } from "@/lib/ui/format-time";
import { splitHighlightedText } from "@/lib/ui/highlight";
import { prepareQuery } from "@/lib/ui/search-query";
import { parseSearchResponse } from "@/lib/ui/search-response";

describe("prepareQuery", () => {
  it("trims and classifies a valid bilingual query", () => {
    expect(prepareQuery(" 你好 ")).toEqual({ value: "你好", length: 2, validity: "valid" });
  });

  it("rejects empty, short, and overlong queries", () => {
    expect(prepareQuery("   ").validity).toBe("empty");
    expect(prepareQuery("a").validity).toBe("too-short");
    expect(prepareQuery("😀").length).toBe(1);
    expect(prepareQuery("x".repeat(101)).validity).toBe("too-long");
  });
});

describe("formatTime", () => {
  it("formats minute and hour timestamps", () => {
    expect(formatTime(65_999)).toBe("01:05");
    expect(formatTime(3_661_000)).toBe("1:01:01");
  });

  it("rejects invalid timestamps", () => {
    expect(() => formatTime(-1)).toThrow(RangeError);
  });
});

describe("splitHighlightedText", () => {
  it("finds multiple case-insensitive matches", () => {
    expect(splitHighlightedText("Bazinga, BAZINGA!", "bazinga")).toEqual([
      { text: "Bazinga", highlighted: true },
      { text: ", ", highlighted: false },
      { text: "BAZINGA", highlighted: true },
      { text: "!", highlighted: false },
    ]);
  });

  it("treats regex punctuation as literal text", () => {
    expect(splitHighlightedText("Use [x], not x.", "[x]")).toEqual([
      { text: "Use ", highlighted: false },
      { text: "[x]", highlighted: true },
      { text: ", not x.", highlighted: false },
    ]);
  });
});

describe("parseSearchResponse", () => {
  const result = {
    segmentId: "segment-1",
    clipId: "clip-1",
    episode: "S01E01",
    sourceSequence: 1,
    speaker: null,
    startMs: 1_000,
    textEn: "Hello",
    textZh: "你好",
  };

  it("accepts a response matching the API contract", () => {
    const response = { query: "hello", count: 1, results: [result] };
    expect(parseSearchResponse(response)).toEqual(response);
  });

  it("rejects malformed or inconsistent responses", () => {
    expect(() => parseSearchResponse({ query: "hello", count: 2, results: [result] })).toThrow(TypeError);
    expect(() => parseSearchResponse({ query: "hello", count: 1, results: [{}] })).toThrow(TypeError);
  });
});
