# Phase 4 — Cloud Sync

## 1. Goal

Phase 4 moves the practice dataset from local files into the deployed backend infrastructure.

The pipeline is:

```text
segments.json        -> Supabase dialogue_segments
clips_manifest.json  -> Supabase clips
clips/*.mp4          -> Cloudflare R2
```

This phase is intentionally limited to the first **100 segments/clips**. The project goal is to experience the complete cloud sync workflow, not to import a full TV episode corpus.

Phase 4 ends when:

- 1 episode exists in Supabase
- 100 dialogue segments exist in Supabase
- 100 clip rows exist in Supabase
- 100 MP4 objects exist in R2
- cloud verification passes
- rerunning the scripts does not create duplicates

---

## 2. Frozen decisions

### Dataset size

Only the first 100 Phase 2 segments are synced.

```text
source_sequence 1 -> 100
```

Do not delete the remaining local data. The local Phase 2/3 outputs remain the full source-of-truth dataset.

### Runtime split

Use:

```text
Python -> local subtitle/media processing
Node   -> cloud infrastructure sync
```

Do not add `boto3`, `supabase-py`, or a second cloud SDK stack.

Reuse the existing Node dependencies:

- `@aws-sdk/client-s3`
- `@supabase/supabase-js`

### Sync order

Always sync in this order:

```text
Preflight
  -> R2 upload
  -> Supabase import
  -> cloud verification
```

Do not write database metadata first and upload media later.

### R2 object key

Use deterministic keys:

```text
tbbt/s01e01/0001.mp4
tbbt/s01e01/0002.mp4
...
tbbt/s01e01/0100.mp4
```

No UUID is required in the R2 object key.

### Segment identity

Add `source_sequence` to `dialogue_segments`.

The stable identity of one imported segment is:

```text
(episode_id, source_sequence)
```

This allows safe reruns and deterministic mapping from local corpus rows to Supabase UUIDs.

---

## 3. Scope

Phase 4 includes:

- one migration adding `source_sequence`
- local artifact preflight validation
- R2 upload script
- Supabase import script
- cloud verification script
- dry-run behavior
- overwrite behavior for R2
- `--limit 100`
- idempotent reruns

Phase 4 does not include:

- Search API
- signed clip URLs
- UI
- authentication
- semantic search
- public R2 bucket access
- multiple episodes
- automatic deployment
- retries/queues/workers
- cross-service distributed transaction logic

---

## 4. Inputs

Expected local files:

```text
data/generated/tbbt-s01e01/segments.json
data/generated/tbbt-s01e01/clips_manifest.json
data/generated/tbbt-s01e01/clips/*.mp4
```

Expected environment configuration in local `.env.local`:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME
NEXT_PUBLIC_APP_URL
```

`.env.local` must remain uncommitted.

---

## 5. Migration

Create:

```text
supabase/migrations/002_add_source_sequence.sql
```

Required change:

```sql
alter table public.dialogue_segments
  add column source_sequence integer;

alter table public.dialogue_segments
  add constraint dialogue_segments_source_sequence_positive
  check (source_sequence is null or source_sequence > 0);

create unique index dialogue_segments_episode_source_sequence_uidx
  on public.dialogue_segments (episode_id, source_sequence)
  where source_sequence is not null;
```

For this project, Phase 4 imported rows must always provide `source_sequence`.

The migration allows existing Phase 1 schema state to remain valid before import.

Do not modify `001_initial_schema.sql` retroactively.

---

## 6. New files

Create:

```text
scripts/cloud/
├─ common.mjs
├─ upload_clips.mjs
├─ import_corpus.mjs
└─ verify_cloud.mjs
```

Tests may be placed in the repository's existing test structure as appropriate.

### `common.mjs`

Shared helpers only when clearly useful, for example:

- load `.env.local`
- validate required environment variables
- load JSON files
- parse positive integer CLI values
- build deterministic R2 object keys
- validate episode slug

Keep this file small. Do not build a generic framework.

---

## 7. Environment loading

The Phase 4 scripts run directly with Node, outside the Next.js runtime.

Therefore they must explicitly load `.env.local` before creating Supabase or R2 clients.

Prefer a minimal solution compatible with the existing project. Do not introduce a large configuration library.

Required behavior:

- fail clearly when `.env.local` cannot provide a required value
- never print secret values
- do not write environment values to logs

---

## 8. Preflight validation

Before any cloud write, validate all local inputs.

The preflight contract must verify:

### Corpus

- `segments.json` exists
- episode slug matches the CLI episode
- `segments` is a non-empty array
- selected first `N` rows have valid positive `sequence`
- no duplicate selected sequence values
- selected rows contain valid `start_ms` and `end_ms`

### Clip manifest

- `clips_manifest.json` exists
- episode slug matches the CLI episode
- selected first `N` clip entries exist
- selected clip sequences match selected corpus sequences exactly
- no duplicate selected clip sequence values

### Local clip files

For each selected sequence:

- referenced MP4 exists
- file size > 0

### Limit

Default training dataset limit:

```text
100
```

The scripts must support:

```text
--limit 100
```

Use the first N rows in the corpus order.

Do not select files by arbitrary filesystem order.

If preflight fails, perform **zero cloud writes**.

---

## 9. R2 upload

Implement `upload_clips.mjs`.

### Responsibilities

For the selected first N clips:

```text
local clips/0001.mp4
-> R2 tbbt/s01e01/0001.mp4
```

### Object key builder

For this episode:

```text
slug: tbbt-s01e01
prefix: tbbt/s01e01
```

Sequence formatting:

```text
1   -> 0001.mp4
37  -> 0037.mp4
100 -> 0100.mp4
```

The object key should be generated by code, not copied from a user-editable manifest field.

### Upload behavior

Before uploading an object:

```text
HeadObject
```

If the object exists and `--overwrite` is not supplied:

```text
skip
```

If the object does not exist:

```text
PutObject
```

Upload with:

```text
Content-Type: video/mp4
```

### Overwrite

With:

```text
--overwrite
```

upload the selected files even if the R2 object already exists.

Do not compare file hashes in Phase 4.

### Dry run

Support:

```text
--dry-run
```

Dry run must:

- perform local preflight
- calculate the exact object keys
- print what would be uploaded/skipped
- perform no `PutObject`

It may perform safe read-only cloud checks if useful, but must never mutate cloud state.

### Summary

Print a concise result such as:

```text
Episode: tbbt-s01e01
Selected: 100
Uploaded: 100
Skipped: 0
Failed: 0
```

On the second normal run, the expected result is approximately:

```text
Uploaded: 0
Skipped: 100
Failed: 0
```

---

## 10. Supabase import

Implement `import_corpus.mjs`.

This script runs only after the R2 upload step succeeds.

It must not upload media.

### Episode metadata

Accept explicit CLI metadata:

```text
--episode tbbt-s01e01
--series "The Big Bang Theory"
--season 1
--episode-number 1
```

Optional:

```text
--title "Pilot"
```

Use the Phase 3 manifest `video_duration_ms` for `episodes.duration_ms`.

Do not create a new metadata config file for one episode.

### Episode upsert

Upsert by:

```text
slug
```

Required resulting fields:

```text
slug
a series
season
episode
title
duration_ms
```

### Segment upsert

Select the first N Phase 2 segments.

Map:

```text
sequence             -> source_sequence
start_ms             -> start_ms
end_ms               -> end_ms
speaker               -> speaker
text_en               -> text_en
text_zh               -> text_zh
normalized_en         -> normalized_en
normalized_zh         -> normalized_zh
alignment_confidence  -> alignment_confidence
```

Every segment row also receives the resolved `episode_id`.

Upsert using the conflict identity:

```text
(episode_id, source_sequence)
```

Do not generate your own UUIDs.

After upsert, query the selected rows and build:

```text
source_sequence -> Supabase segment UUID
```

### Clip upsert

Join:

```text
clips_manifest sequence
-> dialogue_segments.source_sequence
-> dialogue_segments.id
```

Map clip rows:

```text
segment_id
object_key
clip_start_ms
clip_end_ms
duration_ms
status = ready
```

Object key:

```text
tbbt/s01e01/{sequence:04d}.mp4
```

Upsert by the existing unique `segment_id`.

### Batch operations

Do not send one Supabase request per row.

Preferred flow:

```text
upsert episode
-> batch upsert 100 segments
-> fetch sequence/id mapping
-> batch upsert 100 clips
```

A few database requests are sufficient.

### Dry run

Support:

```text
--dry-run
```

It must print a plan such as:

```text
Would upsert:
1 episode
100 segments
100 clips
```

No Supabase writes are allowed in dry-run mode.

---

## 11. Cloud verification

Implement `verify_cloud.mjs`.

Default expected dataset:

```text
--expected 100
```

### Supabase checks

Verify for `tbbt-s01e01`:

```text
episodes = 1
selected dialogue_segments = 100
selected clips = 100
```

Also verify:

- `source_sequence` covers 1 through 100 for this import
- no duplicate `source_sequence`
- every imported segment has exactly one clip
- each clip status is `ready`
- each clip has the deterministic expected object key

### R2 checks

Verify each expected object using `HeadObject`.

Expected keys:

```text
tbbt/s01e01/0001.mp4
...
tbbt/s01e01/0100.mp4
```

Do not download all MP4 files.

Phase 3 already verified media integrity locally.

### Output

Example:

```text
Episode: tbbt-s01e01
Expected: 100
Supabase segments: 100
Supabase clips: 100
R2 objects present: 100
Result: PASS
```

Any count mismatch or missing object must return a failing process exit code.

---

## 12. Failure strategy

Do not implement queues, retries, rollback services, or distributed transactions.

The recovery model is:

```text
fix the cause
-> rerun
```

This works because:

- R2 object keys are deterministic
- existing R2 objects are skipped by default
- episodes are upserted by slug
- segments are upserted by `(episode_id, source_sequence)`
- clips are upserted by `segment_id`

### Why R2 first

If R2 succeeds but Supabase fails:

```text
some media exists without DB references
```

This is acceptable because rerunning the import completes the metadata.

If Supabase were written first and R2 later failed, the database could falsely report a clip as ready when the media object did not exist.

Therefore keep:

```text
R2 first
Supabase second
```

---

## 13. Commands

Exact final CLI shape may adapt slightly to implementation, but preserve these semantics.

### R2 dry run

```powershell
node .\scripts\cloud\upload_clips.mjs `
  --episode tbbt-s01e01 `
  --manifest .\data\generated\tbbt-s01e01\clips_manifest.json `
  --limit 100 `
  --dry-run
```

### R2 upload

```powershell
node .\scripts\cloud\upload_clips.mjs `
  --episode tbbt-s01e01 `
  --manifest .\data\generated\tbbt-s01e01\clips_manifest.json `
  --limit 100
```

### Supabase dry run

```powershell
node .\scripts\cloud\import_corpus.mjs `
  --episode tbbt-s01e01 `
  --series "The Big Bang Theory" `
  --season 1 `
  --episode-number 1 `
  --segments .\data\generated\tbbt-s01e01\segments.json `
  --manifest .\data\generated\tbbt-s01e01\clips_manifest.json `
  --limit 100 `
  --dry-run
```

### Supabase import

Run the same command without `--dry-run`.

### Verify cloud

```powershell
node .\scripts\cloud\verify_cloud.mjs `
  --episode tbbt-s01e01 `
  --expected 100
```

---

## 14. Manual execution order

Do not run everything blindly in one command during the first practice pass.

Use this sequence:

```text
1. Run migration 002 in Supabase
2. Inspect Table Editor / schema
3. Run R2 dry-run
4. Review object keys and selected count
5. Run real R2 upload
6. Inspect R2 dashboard and spot-check objects
7. Run Supabase dry-run
8. Review planned row counts
9. Run real Supabase import
10. Inspect Supabase tables
11. Run verify_cloud.mjs
12. Run upload/import again once to confirm idempotency
```

The second run should not create additional logical records.

---

## 15. Security rules

- R2 bucket remains private
- do not enable public R2 access
- never commit `.env.local`
- never log Secret Access Key
- never log Supabase secret/service-role key
- cloud scripts are local administrative scripts, not browser code
- do not expose cloud credentials through `NEXT_PUBLIC_*`

Signed media URLs belong to a later phase.

---

## 16. Tests

Keep tests proportional to a practice project.

Recommended coverage:

- object key formatting
- positive CLI limit parsing
- preflight detects missing clip
- preflight detects sequence mismatch
- preflight selects first N corpus rows deterministically
- dry-run performs no writes
- existing R2 object is skipped
- overwrite chooses upload path
- segment payload maps `sequence -> source_sequence`
- clip rows use the correct segment UUID mapping
- verification detects missing R2 object
- verification detects Supabase count mismatch

Mock external cloud calls in unit tests.

Do not require real Supabase or R2 credentials for the automated test suite.

Real infrastructure is checked through the manual Phase 4 execution and `verify_cloud.mjs`.

---

## 17. Definition of Done

Phase 4 is complete when all of the following are true:

- [ ] `002_add_source_sequence.sql` exists
- [ ] migration has been applied to Supabase
- [ ] `(episode_id, source_sequence)` is uniquely constrained for imported rows
- [ ] `scripts/cloud/upload_clips.mjs` exists
- [ ] `scripts/cloud/import_corpus.mjs` exists
- [ ] `scripts/cloud/verify_cloud.mjs` exists
- [ ] all scripts support the required `--limit` semantics
- [ ] upload and import support `--dry-run`
- [ ] R2 upload supports `--overwrite`
- [ ] local preflight completes before cloud writes
- [ ] exactly the first 100 segments are selected
- [ ] 100 deterministic MP4 object keys exist in R2
- [ ] 1 episode row exists in Supabase
- [ ] 100 selected dialogue segment rows exist in Supabase
- [ ] 100 selected clip rows exist in Supabase
- [ ] `verify_cloud.mjs --expected 100` passes
- [ ] rerunning R2 upload skips existing objects by default
- [ ] rerunning database import creates no duplicates
- [ ] tests pass
- [ ] lint/build still pass where applicable
- [ ] no secrets or copyrighted media are committed

---

## 18. Explicit non-goals

Do not add any of the following in Phase 4:

- Redis
- queue system
- worker service
- Docker orchestration
- Prisma/ORM
- authentication
- signed URL endpoint
- search endpoint
- frontend changes
- semantic/vector search
- automatic full-episode sync
- multiple-episode configuration system
- media transcoding in the cloud
- hash-based object synchronization
- generalized ETL framework

If an implementation choice is not necessary to sync the 100-row practice dataset safely, defer it.

---

## 19. Codex execution prompt

Use this prompt for Phase 4:

```text
You are implementing Phase 4 of bbc-search.

Read first:
- docs/IMPLEMENTATION_MANUAL.md
- docs/PHASE_4_CLOUD_SYNC.md
- AGENTS.md
- supabase/migrations/001_initial_schema.sql
- lib/env.ts
- lib/r2/client.ts
- lib/supabase/server.ts
- scripts/corpus/build_corpus.py
- scripts/corpus/generate_clips.py
- current tests and package.json

Scope:
Implement only Phase 4 Cloud Sync as specified in docs/PHASE_4_CLOUD_SYNC.md.

Frozen project decisions:
- this is a single-episode practice project
- sync only the first 100 segments/clips
- use Node for cloud scripts
- add source_sequence to dialogue_segments
- stable segment identity is (episode_id, source_sequence)
- R2 keys are deterministic: tbbt/s01e01/{sequence:04d}.mp4
- R2 upload happens before Supabase import
- reruns must be idempotent
- support dry-run
- support R2 overwrite
- do not change Phase 2/3 local artifacts

Do not implement:
- Phase 5 Search API
- signed media URLs
- UI
- auth
- semantic search
- queues/workers
- Python cloud SDKs
- multiple episodes
- public R2 access
- extra abstractions for future phases

Before coding:
1. inspect the repository and Phase 2/3 output contracts
2. summarize the implementation plan
3. identify exact files to create/change
4. flag any conflict between the current repository and the Phase 4 contract

Then implement.

After implementation:
1. run relevant automated tests
2. run lint/build where applicable
3. do not perform real cloud writes automatically unless explicitly requested
4. provide the exact manual commands for:
   - applying migration 002
   - R2 dry-run
   - R2 real upload
   - Supabase dry-run
   - Supabase real import
   - cloud verification
5. summarize changed files
6. report assumptions
7. do not expand scope without approval
```
