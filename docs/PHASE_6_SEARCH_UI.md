# Phase 6 — Search UI

## Goal

Build the first user-facing search experience on top of the completed Phase 5 API.

Phase 6 is intentionally limited to search and result browsing. It does **not** load real media, generate signed URLs, or implement the final player flow.

The user-facing loop is:

```text
search input
→ GET /api/search?q=...
→ bilingual result list
→ select a result
→ placeholder player panel
```

This phase establishes the page state model, URL synchronization, result presentation, responsive layout, and UI-only keyword highlighting that later phases will reuse.

---

# 1. Phase Boundary

## In scope

- Search page at `/`
- Search input
- 300 ms debounce
- Enter triggers immediate search
- Search state reflected in `?q=`
- Refresh restores query from URL
- Calls existing `GET /api/search?q=...`
- Search states:
  - initial
  - typing
  - loading
  - results
  - no results
  - error
- Result list
- English + Chinese text
- Episode + timestamp metadata
- Omit speaker when null
- UI-only keyword highlighting
- Result selection
- Placeholder player panel on desktop
- Responsive single-column mobile layout
- Tests for core UI/state logic

## Out of scope

- `GET /api/clips/{clipId}`
- R2 signed URLs
- Real `<video>` playback
- Share flow
- `/clip/{clipId}` page
- Bottom sheet / full-screen mobile player
- Authentication
- Pagination
- Infinite scroll
- Search suggestions
- Fuzzy search / FTS / embeddings
- Persistent favorites/history

Do not expand Phase 6 into later phases.

---

# 2. Existing API Contract

Phase 6 must consume the Phase 5 endpoint exactly as implemented:

```http
GET /api/search?q=photon
```

Success shape:

```json
{
  "query": "photon",
  "count": 2,
  "results": [
    {
      "segmentId": "...",
      "clipId": "...",
      "episode": "S01E01",
      "sourceSequence": 1,
      "speaker": null,
      "startMs": 2380,
      "textEn": "So if a photon is directed through a plane",
      "textZh": "如果一个光子打向有两个狭缝的平面"
    }
  ]
}
```

Invalid query:

```json
{ "error": "invalid_query" }
```

with HTTP 400.

Search failure:

```json
{ "error": "search_failed" }
```

with HTTP 500.

Do not duplicate search ranking or database logic in the browser.

---

# 3. Search Interaction Contract

## Minimum query length

The UI follows the API rule:

```text
2 <= normalized character count <= 100
```

For fewer than 2 characters:

- do not send an API request
- keep the current input visible
- show a lightweight typing/helper state
- clear prior search results once the new query is intentionally below the valid threshold

The UI does not need to independently reproduce every Phase 5 normalization detail. The server remains authoritative.

---

## Debounce

Typing a valid query waits:

```text
300 ms
```

before requesting `/api/search`.

Example:

```text
p
ph
pho
phot
photon
      ↓ 300 ms idle
GET /api/search?q=photon
```

Only the latest query should determine visible results.

Use request cancellation or equivalent stale-response protection so an older request cannot overwrite a newer search.

---

## Enter behavior

Pressing Enter with a valid query:

- cancels the pending debounce timer
- starts the search immediately
- updates the URL immediately

Do not create a second duplicate request from the debounce timer afterward.

---

# 4. URL Synchronization

The search page URL is the durable representation of the current committed search query.

Example:

```text
/?q=photon
```

Rules:

1. When a valid search is committed, replace the URL with `?q=<query>`.
2. Do not create a browser-history entry for every keystroke.
3. Prefer `router.replace(...)` for search-state synchronization.
4. On initial page load, read `q` from the URL.
5. If URL `q` is valid, populate the input and run the search automatically.
6. Refreshing `/?q=photon` must restore the same query/results.
7. If the query is cleared, return to `/`.

The URL should contain the human-entered trimmed query, not a hidden database-normalized representation.

---

# 5. Page State Model

Use an explicit state model rather than scattered booleans.

Conceptually:

```text
initial
  ↓ typing
loading
  ↓
results | empty | error
```

Recommended logical state:

```ts
type SearchStatus =
  | "initial"
  | "typing"
  | "loading"
  | "results"
  | "empty"
  | "error";
```

State meanings:

### initial

- no committed query
- no results
- primary prompt invites search

### typing

- current input is not yet searched
- usually during debounce or when fewer than 2 characters are entered

### loading

- valid query request is in flight

### results

- successful response with one or more results

### empty

- successful response with zero results

### error

- request failed or returned an unexpected response

Do not silently preserve stale results behind an error/loading state if they could be mistaken for the new query's results.

---

# 6. Result Selection State

Each search result has a `clipId` and may be selected.

Phase 6 selection does **not** request media.

Recommended state:

```ts
selectedClipId: string | null
```

When the user clicks the result card or its Play button:

- set `selectedClipId`
- visually mark that result as selected
- show its dialogue metadata in the placeholder player panel

If a new search completes and the selected result is no longer present:

```text
selectedClipId = null
```

Do not retain a stale selection across unrelated searches.

---

# 7. Desktop Layout

Target layout:

```text
┌───────────────────────────────────────────────────────┐
│                    Search Input                       │
├───────────────────────────┬───────────────────────────┤
│ Results                   │ Player placeholder        │
│                           │                           │
│ Result 1                  │ Selected result metadata  │
│ Result 2                  │                           │
│ Result 3                  │ Real video comes Phase 7  │
│ ...                       │                           │
└───────────────────────────┴───────────────────────────┘
```

Guidelines:

- Search input is the first visual focus.
- Results column is the main interaction area.
- Player placeholder is secondary.
- Avoid dashboard-style density.
- Avoid poster grids.
- Avoid decorative animation.

The placeholder panel exists only to establish the later player layout.

---

# 8. Mobile Layout

Use a simple single-column layout.

```text
Search
↓
Results
↓
Selected-result placeholder
```

Do **not** implement bottom sheets or a full-screen mobile player yet.

A later phase can replace the placeholder interaction with a richer mobile playback flow.

---

# 9. Result Card Contract

Each result displays:

```text
S01E01 · 00:02

So if a photon is directed through a plane
如果一个光子打向有两个狭缝的平面

[Play]
```

If speaker is non-null:

```text
S01E01 · Sheldon · 05:31
```

If speaker is null:

```text
S01E01 · 05:31
```

Do not render placeholders such as:

```text
Unknown speaker
—
N/A
```

for the current corpus.

---

# 10. Timestamp Formatting

Convert `startMs` to `MM:SS` for the result list.

Examples:

```text
2380 ms   → 00:02
71200 ms  → 01:11
```

If future episodes exceed 60 minutes, the helper may support `HH:MM:SS`, but do not overcomplicate the current UI.

Keep this formatting in a small reusable helper with tests.

---

# 11. Keyword Highlighting

Highlight matches only in rendered text.

Never alter:

- database text
- API text
- search normalization

Example query:

```text
photon
```

Rendered English:

```text
So if a [photon] is directed through a plane
```

Requirements:

- case-insensitive for English
- literal substring matching
- do not interpret the query as a regular expression
- support multiple occurrences
- work independently in English and Chinese text

A small helper may split a string into highlighted/non-highlighted fragments.

Do not use `dangerouslySetInnerHTML`.

---

# 12. Visual Direction

Keep the existing MVP visual direction:

- dark theme
- neutral gray background
- low-contrast borders
- clean typography
- restrained accent treatment
- search first
- content second
- no Netflix imitation
- no excessive gradients
- no ornamental motion

The UI should feel like a focused search utility, not a streaming homepage.

---

# 13. Suggested File Structure

Keep the implementation compact.

Suggested structure:

```text
app/
├─ page.tsx
└─ globals.css

components/
└─ search/
   ├─ search-page.tsx
   ├─ search-input.tsx
   ├─ search-results.tsx
   ├─ search-result-card.tsx
   └─ player-placeholder.tsx

lib/
└─ ui/
   ├─ format-time.ts
   └─ highlight.ts
```

Codex may reasonably adjust exact component boundaries if it finds a simpler implementation, but avoid creating a large component system.

Do not add a state-management library.

React state/hooks are sufficient.

---

# 14. Client / Server Boundary

The interactive search UI will require a client component.

Recommended pattern:

```text
app/page.tsx
  ↓
<SearchPage /> client component
```

`SearchPage` owns:

- input state
- debounce
- fetch
- URL synchronization
- result state
- selection state

Secrets remain server-side because the browser calls only:

```text
/api/search
```

The browser must never receive Supabase service credentials or R2 credentials.

---

# 15. Fetch Behavior

Use standard `fetch` to call:

```text
/api/search?q=...
```

Recommended behavior:

- create an `AbortController` per active request
- abort the previous request when starting a new search
- ignore `AbortError`
- verify `response.ok`
- validate the response shape sufficiently to avoid crashing on malformed data
- treat non-200 responses as UI error state

Do not retry automatically.

---

# 16. Initial Query Restoration

For:

```text
http://localhost:3000/?q=photon
```

on initial page load:

1. read `q`
2. populate input
3. if valid, execute search
4. show loading
5. render results

Avoid duplicate initial requests caused by both URL initialization and debounce effects.

This behavior should be tested.

---

# 17. Error UX

Search errors should be concise.

Example:

```text
Search failed. Try again.
```

Do not expose:

- Supabase error codes
- database table names
- stack traces
- secrets

Provide an explicit retry action only if it remains simple; otherwise the user can edit or resubmit the query.

---

# 18. Empty State

For a successful zero-result search:

```text
No matches for “craxy”.
```

This is distinct from an error.

Keep the entered query visible.

---

# 19. Loading State

Loading should be visible but lightweight.

Examples:

```text
Searching…
```

or a restrained skeleton/list placeholder.

Do not add a large animated loading system.

---

# 20. Placeholder Player Panel

Before selection:

```text
Select a result to preview it.
```

After selection:

```text
S01E01 · 00:02

English text
Chinese text

Video playback will be connected in Phase 7.
```

The Play button in Phase 6 means “select this result”.

It does **not** imply that the video should already work.

Do not create a fake media URL.

---

# 21. Tests

Keep tests focused on behavior rather than pixel output.

At minimum cover:

## Helpers

- `formatTime(2380) -> "00:02"`
- 60+ seconds
- literal highlight
- case-insensitive English highlight
- multiple occurrences
- regex-special query characters are treated literally

## Search behavior

Where practical, test:

- fewer than 2 characters does not fetch
- valid query triggers fetch
- debounce behavior
- Enter triggers immediate search
- stale request cannot replace newer results
- success renders results
- empty response renders empty state
- failed request renders error state
- null speaker is omitted
- selecting result updates placeholder
- URL query restores initial search

Do not spend disproportionate effort on browser-test infrastructure if the repository does not already have it. Unit-test extracted helpers/state logic where appropriate.

---

# 22. Manual Verification

After implementation:

```bash
npm run test
npm run lint
npm run build
npm run dev
```

Then manually verify:

### Initial

Open:

```text
http://localhost:3000
```

Expected:

- search input visible
- no API request yet
- initial prompt visible

### English search

Search a term known to exist in the first 100 segments.

Expected:

- 300 ms debounce
- URL becomes `/?q=...`
- bilingual results appear
- matched text is highlighted

### Chinese search

Search a Chinese phrase known to exist.

Expected:

- results appear
- Chinese match is highlighted

### Refresh

Refresh the result URL.

Expected:

- input is restored
- search reruns
- results return

### Selection

Click Play on a result.

Expected:

- result becomes selected
- right-side placeholder displays its metadata/dialogue
- no real video request occurs

### Empty search

Use a valid-length term with no matches.

Expected:

- no-results state
- no error state

---

# 23. Definition of Done

Phase 6 is complete when:

1. `/` renders the search UI.
2. Search waits 300 ms after typing.
3. Enter searches immediately.
4. Queries shorter than 2 characters do not call the API.
5. Search state is synchronized to `?q=`.
6. Refresh restores and reruns a valid URL query.
7. Phase 5 API results render correctly.
8. English and Chinese dialogue are both shown when present.
9. Null speaker is omitted cleanly.
10. Episode and timestamp metadata are shown.
11. Query highlighting is UI-only and safe.
12. Results can be selected.
13. Desktop has result + placeholder-player layout.
14. Mobile is usable as a single column.
15. Loading, empty, and error states are distinct.
16. No real media URL or R2 access is introduced.
17. No service credentials reach the client.
18. Tests pass.
19. Lint passes.
20. Build passes.

---

# 24. Codex Execution Prompt

Use this prompt for Phase 6 implementation:

```text
Implement Phase 6 for this repository using docs/PHASE_6_SEARCH_UI.md as the execution contract.

Context:
- Phase 5 search API is already complete at GET /api/search?q=...
- The database currently contains one TBBT episode and a 100-segment practice dataset.
- Phase 6 is search UI only. Do not implement real media playback, signed URLs, sharing, clip detail routes, authentication, FTS, fuzzy search, embeddings, or unrelated infrastructure.

Required behavior:
1. Build the homepage search UI at `/`.
2. Use the existing Phase 5 API; do not duplicate server-side search logic in the client.
3. Require at least 2 query characters before sending a request.
4. Use 300 ms debounce while typing.
5. Enter must cancel pending debounce and search immediately.
6. Keep the committed query synchronized with `/?q=...` using replace-style navigation rather than adding history on every keystroke.
7. On page load, restore a valid `q` from the URL and run that search once.
8. Prevent stale/older requests from replacing results for a newer query. AbortController is preferred.
9. Implement explicit initial, typing, loading, results, empty, and error states.
10. Render result metadata, English text, Chinese text, and omit speaker entirely when it is null.
11. Format `startMs` as a readable timestamp.
12. Highlight literal query occurrences in rendered dialogue only. Do not use dangerouslySetInnerHTML.
13. Allow selecting a result. The Play button only selects the result in Phase 6.
14. On desktop, show results and a right-side placeholder player panel.
15. On mobile, use a simple single-column layout; do not implement bottom sheets yet.
16. The placeholder panel may show selected dialogue metadata but must not request media or fabricate URLs.
17. Keep the visual style restrained: dark, neutral gray, low-contrast borders, search-focused, no poster grid or decorative animation.
18. Keep component structure compact and do not add a state-management library.
19. Add focused tests for helpers and important search-state behavior where practical.
20. Run and fix npm test, npm run lint, and npm run build.

Before coding, inspect the existing Phase 5 types/API and current app structure. Preserve current contracts unless this document explicitly changes them.

Do not modify Phase 2–4 corpus/cloud behavior.
```
