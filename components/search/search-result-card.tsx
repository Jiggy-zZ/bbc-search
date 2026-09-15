import type { SearchResult } from "@/lib/search/types";
import { formatTime } from "@/lib/ui/format-time";

import { HighlightedText } from "./highlighted-text";

interface SearchResultCardProps {
  result: SearchResult;
  query: string;
  selected: boolean;
  onSelect: () => void;
}

export function SearchResultCard({ result, query, selected, onSelect }: SearchResultCardProps) {
  const episode = result.episode;
  const speaker = result.speaker;

  return (
    <li>
      <button
        className="result-card"
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
      >
        <span className="result-meta">
          {episode ? <span>{episode}</span> : null}
          {speaker ? <span>{speaker}</span> : null}
          <time>{formatTime(result.startMs)}</time>
        </span>
        {result.textEn ? (
          <span className="result-english">
            <HighlightedText text={result.textEn} query={query} />
          </span>
        ) : null}
        {result.textZh ? (
          <span className="result-chinese">
            <HighlightedText text={result.textZh} query={query} />
          </span>
        ) : null}
        <span className="play-label" aria-hidden="true">
          <span className="play-icon">▶</span>
          {selected ? "Selected" : "Play clip"}
        </span>
      </button>
    </li>
  );
}
