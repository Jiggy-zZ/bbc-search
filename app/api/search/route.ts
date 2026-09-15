import type { SupabaseClient } from "@supabase/supabase-js";

import {
  normalizeChineseSearchText,
  normalizeEnglishSearchText,
  normalizeSearchQuery,
  normalizedCharacterCount,
} from "@/lib/search/normalize";
import { sortSearchResults } from "@/lib/search/rank";
import type {
  ClipRelation,
  EpisodeRelation,
  RankedSearchCandidate,
  SearchDatabaseCandidate,
  SearchResponse,
  SearchResult,
} from "@/lib/search/types";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 100;
const MAX_RESULTS = 50;
const MAX_CANDIDATES_PER_LANGUAGE = 100;

const SEARCH_COLUMNS = `
  id,
  source_sequence,
  speaker,
  start_ms,
  text_en,
  text_zh,
  normalized_en,
  normalized_zh,
  episodes!inner(season, episode),
  clips!inner(id, status)
`;

export type SearchCandidateFetcher = (
  normalizedQuery: string,
) => Promise<SearchDatabaseCandidate[]>;

type ErrorLogger = (message: string) => void;

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}

async function queryLanguage(
  client: SupabaseClient,
  column: "normalized_en" | "normalized_zh",
  pattern: string,
): Promise<SearchDatabaseCandidate[]> {
  const { data, error } = await client
    .from("dialogue_segments")
    .select(SEARCH_COLUMNS)
    .ilike(column, pattern)
    .eq("clips.status", "ready")
    .limit(MAX_CANDIDATES_PER_LANGUAGE);

  if (error) {
    throw error;
  }
  return (data ?? []) as unknown as SearchDatabaseCandidate[];
}

export async function fetchSearchCandidates(
  normalizedQuery: string,
): Promise<SearchDatabaseCandidate[]> {
  const client = getSupabaseServerClient();
  const pattern = `%${escapeLikePattern(normalizedQuery)}%`;
  const [english, chinese] = await Promise.all([
    queryLanguage(client, "normalized_en", pattern),
    queryLanguage(client, "normalized_zh", pattern),
  ]);

  const unique = new Map<string, SearchDatabaseCandidate>();
  for (const candidate of [...english, ...chinese]) {
    unique.set(candidate.id, candidate);
  }
  return [...unique.values()];
}

function relationValues<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

function formatEpisodeLabel(episode: EpisodeRelation): string {
  return `S${String(episode.season).padStart(2, "0")}E${String(episode.episode).padStart(2, "0")}`;
}

function mapCandidate(
  candidate: SearchDatabaseCandidate,
): RankedSearchCandidate | null {
  const episode = relationValues(candidate.episodes)[0];
  const clip = relationValues(candidate.clips).find(
    (value: ClipRelation) => value.status === "ready",
  );
  if (!episode || !clip) {
    return null;
  }
  if (
    !candidate.id ||
    !clip.id ||
    !Number.isSafeInteger(candidate.source_sequence) ||
    candidate.source_sequence <= 0 ||
    !Number.isSafeInteger(candidate.start_ms) ||
    candidate.start_ms < 0 ||
    !Number.isSafeInteger(episode.season) ||
    !Number.isSafeInteger(episode.episode)
  ) {
    throw new Error("Supabase returned an invalid search candidate");
  }

  return {
    segmentId: candidate.id,
    clipId: clip.id,
    episode: formatEpisodeLabel(episode),
    sourceSequence: candidate.source_sequence,
    speaker: candidate.speaker,
    startMs: candidate.start_ms,
    textEn: candidate.text_en,
    textZh: candidate.text_zh,
    normalizedEn:
      candidate.normalized_en === null
        ? null
        : normalizeEnglishSearchText(candidate.normalized_en),
    normalizedZh:
      candidate.normalized_zh === null
        ? null
        : normalizeChineseSearchText(candidate.normalized_zh),
  };
}

function toPublicResult(candidate: RankedSearchCandidate): SearchResult {
  return {
    segmentId: candidate.segmentId,
    clipId: candidate.clipId,
    episode: candidate.episode,
    sourceSequence: candidate.sourceSequence,
    speaker: candidate.speaker,
    startMs: candidate.startMs,
    textEn: candidate.textEn,
    textZh: candidate.textZh,
  };
}

function safeErrorIdentifier(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "UnknownError";
  }
  for (const key of ["code", "name"] as const) {
    const value = Reflect.get(error, key);
    if (typeof value === "string" && /^[a-z0-9_.-]+$/iu.test(value)) {
      return value;
    }
  }
  return "UnknownError";
}

function invalidQueryResponse(): Response {
  return Response.json({ error: "invalid_query" }, { status: 400 });
}

export function createSearchHandler(
  fetchCandidates: SearchCandidateFetcher = fetchSearchCandidates,
  logError: ErrorLogger = console.error,
): (request: Request) => Promise<Response> {
  return async function searchHandler(request: Request): Promise<Response> {
    const rawQuery = new URL(request.url).searchParams.get("q");
    if (rawQuery === null) {
      return invalidQueryResponse();
    }

    const query = normalizeSearchQuery(rawQuery);
    const queryLength = normalizedCharacterCount(query);
    if (queryLength < MIN_QUERY_LENGTH || queryLength > MAX_QUERY_LENGTH) {
      return invalidQueryResponse();
    }

    try {
      const databaseCandidates = await fetchCandidates(query);
      const candidates = databaseCandidates
        .map(mapCandidate)
        .filter(
          (candidate): candidate is RankedSearchCandidate => candidate !== null,
        );
      const results = sortSearchResults(candidates, query)
        .slice(0, MAX_RESULTS)
        .map(toPublicResult);
      const response: SearchResponse = {
        query,
        count: results.length,
        results,
      };
      return Response.json(response);
    } catch (error) {
      logError(`Search failed: ${safeErrorIdentifier(error)}`);
      return Response.json({ error: "search_failed" }, { status: 500 });
    }
  };
}

export const GET = createSearchHandler();
