import type { SearchResponse, SearchResult } from "@/lib/search/types";

function isNullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isSearchResult(value: unknown): value is SearchResult {
  if (typeof value !== "object" || value === null) return false;
  const result = value as Record<string, unknown>;
  return (
    typeof result.segmentId === "string" &&
    typeof result.clipId === "string" &&
    typeof result.episode === "string" &&
    typeof result.sourceSequence === "number" &&
    isNullableString(result.speaker) &&
    typeof result.startMs === "number" &&
    isNullableString(result.textEn) &&
    isNullableString(result.textZh)
  );
}

export function parseSearchResponse(value: unknown): SearchResponse {
  if (typeof value !== "object" || value === null) throw new TypeError("Invalid search response");
  const response = value as Record<string, unknown>;
  if (
    typeof response.query !== "string" ||
    typeof response.count !== "number" ||
    !Number.isInteger(response.count) ||
    !Array.isArray(response.results) ||
    response.results.length !== response.count ||
    !response.results.every(isSearchResult)
  ) {
    throw new TypeError("Invalid search response");
  }
  return response as unknown as SearchResponse;
}
