import type { ReactNode } from "react";

import type { SearchResult } from "@/lib/search/types";

import { SearchResultCard } from "./search-result-card";

export type SearchViewState =
  | { status: "initial" }
  | { status: "typing"; message: string }
  | { status: "loading"; query: string }
  | { status: "results"; query: string; results: SearchResult[] }
  | { status: "empty"; query: string }
  | { status: "error"; query: string };

interface SearchResultsProps {
  state: SearchViewState;
  selectedClipId: string | null;
  onSelect: (result: SearchResult) => void;
}

function StatusPanel({ children }: { children: ReactNode }) {
  return <div className="status-panel">{children}</div>;
}

export function SearchResults({ state, selectedClipId, onSelect }: SearchResultsProps) {
  if (state.status === "initial") {
    return (
      <StatusPanel>
        <span className="status-symbol">⌕</span>
        <h2>Start with a line you remember</h2>
        <p>Search across English and Chinese subtitles.</p>
      </StatusPanel>
    );
  }
  if (state.status === "typing") return <StatusPanel><p>{state.message}</p></StatusPanel>;
  if (state.status === "loading") {
    return <StatusPanel><span className="loader" aria-hidden="true" /><p>Searching for “{state.query}”…</p></StatusPanel>;
  }
  if (state.status === "empty") {
    return <StatusPanel><span className="status-symbol">∅</span><h2>No matches for “{state.query}”</h2><p>Try a shorter phrase or a different translation.</p></StatusPanel>;
  }
  if (state.status === "error") {
    return <StatusPanel><span className="status-symbol">!</span><h2>Search failed</h2><p>Try again in a moment.</p></StatusPanel>;
  }

  return (
    <section aria-label="Search results">
      <div className="results-heading"><h2>Matches</h2><span>{state.results.length} found</span></div>
      <ul className="result-list">
        {state.results.map((result) => (
          <SearchResultCard
            key={result.segmentId}
            result={result}
            query={state.query}
            selected={result.clipId === selectedClipId}
            onSelect={() => onSelect(result)}
          />
        ))}
      </ul>
    </section>
  );
}
