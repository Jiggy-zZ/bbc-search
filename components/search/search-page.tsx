"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import type { SearchResult } from "@/lib/search/types";
import { prepareQuery } from "@/lib/ui/search-query";
import { parseSearchResponse } from "@/lib/ui/search-response";

import { PlayerPlaceholder } from "./player-placeholder";
import { SearchInput } from "./search-input";
import { SearchResults, type SearchViewState } from "./search-results";

const SEARCH_DEBOUNCE_MS = 300;

function typingMessage(validity: ReturnType<typeof prepareQuery>["validity"]): string {
  return validity === "too-long"
    ? "Keep the search to 100 characters or fewer."
    : "Type at least 2 characters to search.";
}

export function SearchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [inputValue, setInputValue] = useState("");
  const [viewState, setViewState] = useState<SearchViewState>({ status: "initial" });
  const [selection, setSelection] = useState<SearchResult | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const appliedUrlQueryRef = useRef<string | null>(null);

  const cancelPendingWork = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    requestRef.current?.abort();
    requestRef.current = null;
    requestIdRef.current += 1;
  }, []);

  const runSearch = useCallback(
    async (rawQuery: string, syncUrl: boolean) => {
      const prepared = prepareQuery(rawQuery);
      cancelPendingWork();

      if (prepared.validity !== "valid") {
        setSelection(null);
        setViewState(
          prepared.validity === "empty"
            ? { status: "initial" }
            : { status: "typing", message: typingMessage(prepared.validity) },
        );
        return;
      }

      if (syncUrl) {
        appliedUrlQueryRef.current = prepared.value;
        const nextParams = new URLSearchParams({ q: prepared.value });
        router.replace(`/?${nextParams.toString()}`, { scroll: false });
      }

      const requestId = requestIdRef.current;
      const controller = new AbortController();
      requestRef.current = controller;
      setViewState({ status: "loading", query: prepared.value });

      try {
        const params = new URLSearchParams({ q: prepared.value });
        const response = await fetch(`/api/search?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Search failed with status ${response.status}`);

        const payload = parseSearchResponse(await response.json());
        if (requestId !== requestIdRef.current) return;

        setSelection((current) =>
          current && payload.results.some((result) => result.clipId === current.clipId)
            ? current
            : null,
        );
        setViewState(
          payload.results.length > 0
            ? { status: "results", query: prepared.value, results: payload.results }
            : { status: "empty", query: prepared.value },
        );
      } catch (error) {
        if (controller.signal.aborted || requestId !== requestIdRef.current) return;
        console.error("Subtitle search failed", error);
        setSelection(null);
        setViewState({ status: "error", query: prepared.value });
      } finally {
        if (requestRef.current === controller) requestRef.current = null;
      }
    },
    [cancelPendingWork, router],
  );

  const handleInputChange = (value: string) => {
    setInputValue(value);
    setSelection(null);
    cancelPendingWork();

    const prepared = prepareQuery(value);
    if (prepared.validity !== "valid") {
      appliedUrlQueryRef.current = "";
      router.replace("/", { scroll: false });
      setViewState(
        prepared.validity === "empty"
          ? { status: "initial" }
          : { status: "typing", message: typingMessage(prepared.validity) },
      );
      return;
    }

    setViewState({ status: "typing", message: "Waiting for you to finish typing…" });
    debounceRef.current = setTimeout(() => void runSearch(value, true), SEARCH_DEBOUNCE_MS);
  };

  useEffect(() => {
    const urlQuery = searchParams.get("q") ?? "";
    if (appliedUrlQueryRef.current === urlQuery) return;

    const syncTimer = setTimeout(() => {
      appliedUrlQueryRef.current = urlQuery;
      setInputValue(urlQuery);
      const prepared = prepareQuery(urlQuery);
      if (prepared.validity === "valid") {
        void runSearch(urlQuery, false);
      } else {
        cancelPendingWork();
        setSelection(null);
        setViewState(
          prepared.validity === "empty"
            ? { status: "initial" }
            : { status: "typing", message: typingMessage(prepared.validity) },
        );
      }
    }, 0);

    return () => clearTimeout(syncTimer);
  }, [cancelPendingWork, runSearch, searchParams]);

  useEffect(() => cancelPendingWork, [cancelPendingWork]);

  return (
    <main className="app-shell">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="BBC Search home">
          <span className="brand-mark">BBC</span>
          <span>Search</span>
        </Link>
        <span className="phase-label">Phase 6 · Search UI</span>
      </header>

      <section className="search-hero">
        <p className="eyebrow">Bilingual subtitle search</p>
        <h1>Find the line. Revisit the scene.</h1>
        <p className="hero-copy">
          Search dialogue in English or Chinese, then select the exact moment you remember.
        </p>
        <SearchInput
          value={inputValue}
          onChange={handleInputChange}
          onSubmit={() => void runSearch(inputValue, true)}
        />
      </section>

      <div className="workspace">
        <div className="results-panel" aria-live="polite">
          <SearchResults
            state={viewState}
            selectedClipId={selection?.clipId ?? null}
            onSelect={setSelection}
          />
        </div>
        <PlayerPlaceholder selection={selection} />
      </div>
    </main>
  );
}
