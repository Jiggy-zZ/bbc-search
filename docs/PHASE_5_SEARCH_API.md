# Phase 5 — Search API

## 1. Goal

Phase 5 turns the imported Supabase corpus into a queryable HTTP API.

The phase is intentionally small: one episode, 100 cloud-synced dialogue segments, substring search only.

The API contract is:

```http
GET /api/search?q=photon
```

Phase 5 does **not** implement playback, signed R2 URLs, frontend search UI, fuzzy search, full-text search, embeddings, or semantic search.

---

## 2. Inputs and existing infrastructure

Phase 5 consumes the Phase 4 cloud dataset already verified as:

```text
episodes: 1
dialogue_segments: 100
clips: 100
R2 objects: 100
```

Relevant existing code:

```text
lib/supabase/server.ts
lib/env.ts
app/api/health/route.ts
```

Relevant database relationships:

```text
episodes
  1 ── N dialogue_segments
           1 ── 1 clips
```

Search only returns dialogue segments whose associated clip exists and has:

```text
status = 'ready'
```

---

## 3. Scope

Implement:

```text
app/api/search/route.ts
lib/search/normalize.ts
lib/search/rank.ts
lib/search/types.ts
```

Tests may live beside the modules or in the repository's existing test structure.

Do not add new infrastructure unless required by the current repository conventions.

---

## 4. Request contract

### Endpoint

```http
GET /api/search?q=<query>
```

### Query validation

`q` must:

- exist
- become non-empty after trimming
- contain at least 2 characters after normalization
- contain at most 100 characters after normalization

Invalid requests return:

```http
400 Bad Request
```

Suggested body:

```json
{
  "error": "invalid_query"
}
```

Do not expose internal validation details, stack traces, environment variables, SQL, or service credentials.

---

## 5. Query normalization

Normalization should remain compatible with Phase 2 corpus normalization.

### English

Apply:

```text
trim
Unicode apostrophe normalization
collapse repeated whitespace
lowercase
```

Examples:

```text
"  I'm   CRAZY  "
→ "i'm crazy"
```

Treat these apostrophes as equivalent:

```text
‘
’
ʼ
＇
'
```

### Chinese

Apply:

```text
trim
collapse repeated whitespace
```

No segmentation, stemming, pinyin conversion, simplified/traditional conversion, or punctuation stripping is required.

### Mixed queries

Mixed Chinese/English queries may use the same general whitespace/apostrophe normalization, but do not introduce language detection dependencies.

---

## 6. Search behavior

MVP search remains substring matching:

```text
normalized_en ILIKE '%query%'
OR normalized_zh ILIKE '%query%'
```

This phase intentionally does not add:

```text
pg_trgm
PostgreSQL full-text search
Elasticsearch
vector database
embedding search
LLM reranking
spell correction
```

With only 100 rows, simple substring search is sufficient.

---

## 7. Database query boundary

The route must use the existing server-only Supabase client.

Never expose the Supabase secret key to the browser.

The search query should retrieve enough information to construct the response from:

```text
dialogue_segments
clips
episodes
```

Required conditions:

```text
clip exists
clip.status = 'ready'
```

Do not return segments that cannot be played later.

A valid implementation may use one nested Supabase/PostgREST query or a small number of server-side queries. Prefer clarity over cleverness.

---

## 8. Candidate result limit

The public API returns at most:

```text
50 results
```

Because ranking occurs server-side, the database query may fetch a bounded candidate set larger than 50 if necessary.

For the current 100-row dataset, fetching all matching candidates is acceptable.

Do not fetch unrelated rows and do not implement pagination in Phase 5.

---

## 9. Ranking

Ranking occurs in the Next.js server code after candidate rows are returned from Supabase.

For each result, evaluate both normalized English and normalized Chinese text and keep the best rank.

Priority:

```text
1. exact match
2. starts with query
3. contains query
4. source_sequence ascending
```

Conceptually:

```text
exact       → rank 0
startsWith  → rank 1
contains    → rank 2
```

If English and Chinese produce different ranks, use the better one.

Stable tie-breaker:

```text
source_sequence ascending
```

Since this practice dataset contains one episode only, no additional episode sort is needed.

---

## 10. Response contract

Successful response:

```http
200 OK
```

Shape:

```json
{
  "query": "photon",
  "count": 2,
  "results": [
    {
      "segmentId": "uuid",
      "clipId": "uuid",
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

### Required result fields

```text
segmentId
clipId
episode
sourceSequence
speaker
startMs
textEn
textZh
```

`sourceSequence` is intentionally included for debugging and learning even though the eventual UI does not strictly require it.

### Episode label

For the current dataset:

```text
S01E01
```

Build this from `episodes.season` and `episodes.episode`; do not hard-code the literal label into search result rows.

### Nullable fields

Current Phase 2 behavior means:

```text
speaker = null
```

`textEn` and `textZh` may be nullable because the corpus contract allows one language to be absent.

---

## 11. Empty search result

A valid query with no matches returns:

```http
200 OK
```

```json
{
  "query": "craxy",
  "count": 0,
  "results": []
}
```

Do not return `404` for a valid query with no matches.

---

## 12. Service failure behavior

If Supabase fails:

```http
500 Internal Server Error
```

Suggested response:

```json
{
  "error": "search_failed"
}
```

Server logs may contain a safe error identifier, but the HTTP response must not expose:

```text
SUPABASE_SERVICE_ROLE_KEY
SQL details
stack trace
database connection details
raw provider error payload
```

Follow the same error-sanitization principle already used by `/api/health`.

---

## 13. No media URL in Phase 5

Search results must **not** contain:

```text
mediaUrl
signedUrl
R2 object key
R2 credentials
```

Playback remains a later concern.

The intended future flow is:

```text
Search API
→ clipId
→ GET /api/clips/{clipId}
→ server generates short-lived signed R2 URL
→ player
```

Do not implement `/api/clips/{clipId}` in Phase 5.

---

## 14. Suggested module responsibilities

### `lib/search/normalize.ts`

Own:

```text
normalizeSearchQuery
normalizeEnglishSearchText
normalizeChineseSearchText
```

Keep normalization deterministic and dependency-free.

### `lib/search/rank.ts`

Own:

```text
rankMatch
sortSearchResults
```

The module should not know about Supabase.

### `lib/search/types.ts`

Own shared search-domain TypeScript types for:

```text
raw database candidate
API result
API response
```

Avoid unnecessary generic abstractions.

### `app/api/search/route.ts`

Own:

```text
read q
validate/normalize
query Supabase
map candidates
rank/sort
limit 50
return JSON
sanitize failures
```

---

## 15. Testing contract

Keep tests focused. Roughly 8–12 meaningful tests are enough.

At minimum cover:

### Query validation

- missing `q` → 400
- whitespace-only `q` → 400
- normalized length 1 → 400
- normalized length >100 → 400

### Normalization

- English lowercasing
- repeated whitespace collapse
- Unicode apostrophe normalization
- Chinese whitespace normalization

### Ranking

- exact ranks before starts-with
- starts-with ranks before contains
- English/Chinese best rank wins
- ties resolve by `sourceSequence`

### API behavior

- valid English search returns matching ready clips
- valid Chinese search returns matching ready clips
- valid no-match search returns 200 + empty array
- non-ready/missing clip results are excluded
- result count never exceeds 50
- Supabase failure returns sanitized 500

Tests should not require the real production Supabase project unless the existing repository already has an explicit integration-test pattern.

---

## 16. Manual smoke test

After implementation:

```powershell
npm run test
npm run lint
npm run build
npm run dev
```

Then test with a real word that exists in the first 100 imported segments:

```text
http://localhost:3000/api/search?q=photon
```

Also test a Chinese query from the imported corpus.

Verify:

```text
HTTP 200
count matches returned array length
segmentId exists
clipId exists
episode = S01E01
sourceSequence is correct
speaker = null
English/Chinese text matches Supabase data
```

Test a valid non-match query:

```text
http://localhost:3000/api/search?q=craxy
```

Expected:

```json
{
  "query": "craxy",
  "count": 0,
  "results": []
}
```

---

## 17. Definition of Done

Phase 5 is complete when all are true:

- [ ] `GET /api/search?q=...` exists
- [ ] query validation enforces 2–100 normalized characters
- [ ] query normalization matches Phase 2 conventions
- [ ] English substring search works
- [ ] Chinese substring search works
- [ ] only segments with `clips.status = 'ready'` are returned
- [ ] results include `segmentId` and `clipId`
- [ ] results include `sourceSequence`
- [ ] exact > starts-with > contains ranking is deterministic
- [ ] tie-breaker uses `sourceSequence`
- [ ] maximum response size is 50 results
- [ ] no-match requests return 200 with `results: []`
- [ ] Supabase errors return sanitized 500 responses
- [ ] API never exposes R2 object keys or signed media URLs
- [ ] tests pass
- [ ] lint passes
- [ ] build passes
- [ ] real local smoke test against the imported Supabase dataset succeeds

---

## 18. Explicit non-goals

Do not implement in Phase 5:

```text
Search UI
Player UI
/api/clips/{clipId}
R2 signed URLs
Share pages
pagination
pg_trgm
FTS
embeddings
vector database
semantic search
spell correction
search analytics
authentication
rate-limiting infrastructure
Redis/cache
```

Do not change Phase 2 corpus files or Phase 3 clips.

Do not redesign the database unless implementation reveals an actual blocking defect.

---

# Codex execution prompt

```text
You are implementing Phase 5 of bbc-search: Search API.

Read first:
- docs/IMPLEMENTATION_MANUAL.md
- docs/PHASE_5_SEARCH_API.md
- AGENTS.md
- existing Phase 1 Supabase/server code
- existing Phase 4 schema/migrations and cloud-sync implementation
- existing tests and package scripts

Context:
- Phase 4 cloud verification already passed.
- Supabase contains one episode and the first 100 dialogue segments/clips.
- This is a practice project; keep the implementation small and explicit.

Scope:
- implement GET /api/search?q=...
- implement query normalization
- query Supabase server-side only
- return only segments with ready clips
- implement deterministic server-side ranking:
  exact > starts-with > contains > source_sequence
- return at most 50 results
- include segmentId, clipId, episode, sourceSequence, speaker, startMs, textEn, textZh
- add focused tests

Do not implement:
- frontend search UI
- clip playback endpoint
- R2 signed URLs
- sharing
- pagination
- pg_trgm / FTS / embeddings / vector search
- auth/cache/rate-limiting infrastructure

Before coding:
1. inspect the current repository and relevant Phase 1/4 code
2. summarize the implementation plan
3. identify files to create/change
4. flag any repository convention that changes this document's suggested file layout

Then implement.

After implementation:
1. run relevant tests
2. run npm run lint
3. run npm run build
4. report changed files
5. report assumptions
6. provide exact local smoke-test URLs/commands for one English query, one Chinese query, and one no-match query
7. do not expand scope without approval
```
