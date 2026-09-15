import { Suspense } from "react";
import Link from "next/link";

import { SearchPage } from "@/components/search/search-page";

function SearchPageFallback() {
  return (
    <main className="app-shell" aria-busy="true">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="BBC Search home">
          <span className="brand-mark">BBC</span>
          <span>Search</span>
        </Link>
      </header>
      <section className="search-hero">
        <p className="eyebrow">Bilingual subtitle search</p>
        <h1>Find the line. Revisit the scene.</h1>
      </section>
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<SearchPageFallback />}>
      <SearchPage />
    </Suspense>
  );
}
