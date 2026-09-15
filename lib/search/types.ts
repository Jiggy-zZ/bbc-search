export type EpisodeRelation = {
  episode: number;
  season: number;
};

export type ClipRelation = {
  id: string;
  status: string;
};

export type SearchDatabaseCandidate = {
  id: string;
  source_sequence: number;
  speaker: string | null;
  start_ms: number;
  text_en: string | null;
  text_zh: string | null;
  normalized_en: string | null;
  normalized_zh: string | null;
  episodes: EpisodeRelation | EpisodeRelation[];
  clips: ClipRelation | ClipRelation[];
};

export type SearchResult = {
  segmentId: string;
  clipId: string;
  episode: string;
  sourceSequence: number;
  speaker: string | null;
  startMs: number;
  textEn: string | null;
  textZh: string | null;
};

export type RankedSearchCandidate = SearchResult & {
  normalizedEn: string | null;
  normalizedZh: string | null;
};

export type SearchResponse = {
  query: string;
  count: number;
  results: SearchResult[];
};
