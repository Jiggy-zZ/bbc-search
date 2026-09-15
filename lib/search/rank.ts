import type { RankedSearchCandidate } from "@/lib/search/types";

export type MatchRank = 0 | 1 | 2;

export function rankMatch(
  text: string | null,
  normalizedQuery: string,
): MatchRank | null {
  if (text === null || !text.includes(normalizedQuery)) {
    return null;
  }
  if (text === normalizedQuery) {
    return 0;
  }
  if (text.startsWith(normalizedQuery)) {
    return 1;
  }
  return 2;
}

function bestRank(
  candidate: RankedSearchCandidate,
  normalizedQuery: string,
): MatchRank | null {
  const ranks = [
    rankMatch(candidate.normalizedEn, normalizedQuery),
    rankMatch(candidate.normalizedZh, normalizedQuery),
  ].filter((rank): rank is MatchRank => rank !== null);

  return ranks.length > 0 ? Math.min(...ranks) as MatchRank : null;
}

export function sortSearchResults(
  candidates: RankedSearchCandidate[],
  normalizedQuery: string,
): RankedSearchCandidate[] {
  return candidates
    .map((candidate) => ({
      candidate,
      rank: bestRank(candidate, normalizedQuery),
    }))
    .filter(
      (entry): entry is { candidate: RankedSearchCandidate; rank: MatchRank } =>
        entry.rank !== null,
    )
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        left.candidate.sourceSequence - right.candidate.sourceSequence,
    )
    .map(({ candidate }) => candidate);
}
