# Phase 3 — Clip Generation Execution Contract

> Project: `Jiggy-zZ/bbc-search`  
> Scope: single episode only  
> Goal: convert Phase 2 dialogue segments plus the local MKV episode into browser-playable MP4 clips and a clip manifest.

---

# 1. Phase Goal

Phase 3 only solves one problem:

> For every dialogue segment produced in Phase 2, generate one playable MP4 clip with a small amount of context before and after the subtitle timing.

Data flow:

```text
segments.json
+
tbbt-s01e01.mkv
↓
read source video duration
↓
calculate clip_start / clip_end
↓
FFmpeg transcode
↓
clips/*.mp4
↓
clips_manifest.json
↓
verify clips
```

This phase does **not**:

- connect to Supabase
- upload to Cloudflare R2
- create database UUIDs
- modify `segments.json`
- burn subtitles into video
- merge adjacent subtitle cues
- infer sentence boundaries
- infer speakers
- build a server-side clipping service

Phase 4 will handle upload and database import.

---

# 2. Inputs

Expected local files:

```text
data/
├─ raw/
│  └─ video/
│     └─ tbbt-s01e01.mkv
│
└─ generated/
   └─ tbbt-s01e01/
      └─ segments.json
```

The MKV and generated media remain Git ignored.

`segments.json` is produced by Phase 2 and contains entries such as:

```json
{
  "sequence": 1,
  "start_ms": 2380,
  "end_ms": 4840,
  "speaker": null,
  "text_zh": "如果一个光子打向有两个狭缝的平面",
  "text_en": "So if a photon is directed through a plane",
  "normalized_zh": "如果一个光子打向有两个狭缝的平面",
  "normalized_en": "so if a photon is directed through a plane",
  "alignment_confidence": null
}
```

Phase 3 only depends on:

```text
sequence
start_ms
end_ms
```

Subtitle text is not modified.

---

# 3. Output Structure

Expected result:

```text
data/generated/tbbt-s01e01/
├─ segments.json
├─ clips/
│  ├─ 0001.mp4
│  ├─ 0002.mp4
│  ├─ 0003.mp4
│  └─ ...
└─ clips_manifest.json
```

The generated MP4 files and clip manifest remain under `data/generated/` and are not committed to GitHub.

---

# 4. Clip Unit

Frozen decision:

> **1 dialogue segment = 1 generated clip**

Example:

```text
segment sequence 1
↔
clips/0001.mp4
```

Do not merge adjacent cues in Phase 3.

Reason:

- the project is a one-episode practice project
- the Phase 2 data model already uses subtitle cues as the atomic unit
- merging by sentence would introduce a new NLP problem unrelated to the media pipeline
- playback context can be improved more cheaply with padding

---

# 5. Clip Timing

Frozen defaults:

```text
before padding = 1500 ms
after padding  = 2000 ms
```

For a subtitle segment:

```text
start_ms = 2380
end_ms   = 4840
```

Generated clip timing becomes:

```text
clip_start_ms = 880
clip_end_ms   = 6840
```

Formula:

```python
clip_start_ms = max(0, start_ms - 1500)
clip_end_ms = min(video_duration_ms, end_ms + 2000)
clip_duration_ms = clip_end_ms - clip_start_ms
```

Never modify the original `start_ms` / `end_ms` values inside `segments.json`.

The subtitle timestamp and clip timestamp are different concepts.

---

# 6. Source Video

Input format:

```text
MKV
```

Do not convert the whole episode to MP4 first.

FFmpeg can read MKV directly:

```text
MKV source
↓
FFmpeg
↓
short MP4 clips
```

The original MKV remains the single local media source.

---

# 7. Required Local Tools

Phase 3 requires:

```text
ffmpeg
ffprobe
```

Before processing, the script must verify both commands are available.

Example checks:

```bash
ffmpeg -version
ffprobe -version
```

If either executable is missing, fail with a clear message, for example:

```text
FFmpeg executable not found.
Install FFmpeg and ensure ffmpeg/ffprobe are available in PATH.
```

Do not automatically install FFmpeg from the Python script.

---

# 8. Source Video Duration

Use `ffprobe` to read source video duration before generating clips.

The result should be normalized to integer milliseconds:

```text
video_duration_ms = 1278450
```

The duration is used to clamp the final clip near the end of the episode:

```python
clip_end_ms = min(video_duration_ms, end_ms + AFTER_PADDING_MS)
```

Do not trust subtitle timestamps alone for the final media boundary.

---

# 9. Output Encoding

Frozen output format:

```text
Container: MP4
Video: H.264
Resolution: 480p height
Audio: AAC
Faststart: enabled
```

Recommended FFmpeg command shape:

```bash
ffmpeg \
  -ss {clip_start_seconds} \
  -i data/raw/video/tbbt-s01e01.mkv \
  -t {clip_duration_seconds} \
  -vf "scale=-2:480" \
  -c:v libx264 \
  -preset veryfast \
  -crf 28 \
  -c:a aac \
  -b:a 96k \
  -movflags +faststart \
  -y \
  output.mp4
```

Notes:

- use re-encoding, not `-c copy`
- stream copy can produce inaccurate cuts because of keyframe boundaries
- `-ss` before `-i` is preferred here for efficient seeking across many clips
- exact frame-perfect editing is not required for this practice project

---

# 10. File Naming

Clip filename:

```text
{sequence:04d}.mp4
```

Examples:

```text
0001.mp4
0002.mp4
0042.mp4
0287.mp4
```

Do not generate UUID filenames in Phase 3.

Phase 4 will map these clips to R2 object keys.

Recommended future R2 object key pattern:

```text
tbbt/s01e01/0001.mp4
```

The local Phase 3 script does not need to know anything about R2.

---

# 11. New Files to Implement

Add exactly two new primary scripts:

```text
scripts/corpus/
├─ parse_srt.py
├─ build_corpus.py
├─ verify_corpus.py
├─ generate_clips.py
└─ verify_clips.py
```

## `generate_clips.py`

Responsibilities:

```text
load segments.json
validate episode / segments structure
verify ffmpeg + ffprobe availability
probe source MKV duration
calculate padded clip boundaries
run FFmpeg for every selected segment
write clips_manifest.json
report generated / skipped / failed counts
```

It must not:

- edit Phase 2 output
- connect to cloud services
- add subtitle overlays
- merge cues

## `verify_clips.py`

Responsibilities:

```text
load clips_manifest.json
check every referenced file exists
check file size > 0
probe output duration
compare probed duration with expected duration
report invalid/missing files
optionally print a small review sample
```

---

# 12. CLI Contract — `generate_clips.py`

Recommended usage:

```bash
python scripts/corpus/generate_clips.py \
  --episode tbbt-s01e01 \
  --video data/raw/video/tbbt-s01e01.mkv \
  --segments data/generated/tbbt-s01e01/segments.json \
  --output data/generated/tbbt-s01e01/clips \
  --manifest data/generated/tbbt-s01e01/clips_manifest.json
```

Required arguments:

```text
--episode
--video
--segments
--output
--manifest
```

Optional arguments:

```text
--limit N
--overwrite
```

Padding values should remain code-level Phase 3 constants for this project:

```python
BEFORE_PADDING_MS = 1500
AFTER_PADDING_MS = 2000
```

Do not add unnecessary configuration files.

---

# 13. `--limit`

`--limit` is required for safe test runs.

Example:

```bash
python scripts/corpus/generate_clips.py \
  --episode tbbt-s01e01 \
  --video data/raw/video/tbbt-s01e01.mkv \
  --segments data/generated/tbbt-s01e01/segments.json \
  --output data/generated/tbbt-s01e01/clips \
  --manifest data/generated/tbbt-s01e01/clips_manifest.json \
  --limit 5
```

This should generate only the first five clips.

Recommended workflow:

```text
--limit 5
↓
manual playback check
↓
if correct, run full generation
```

Do not generate the entire episode before verifying a small sample.

---

# 14. Resume and `--overwrite`

Default behavior:

```text
existing output file → skip
```

This allows interrupted runs to continue without regenerating all clips.

Example summary:

```text
Generated: 183
Skipped:   102
Failed:      0
```

With:

```text
--overwrite
```

existing files are regenerated.

Do not introduce job queues, retry services, or persistent worker state.

---

# 15. Failure Behavior

If FFmpeg returns a non-zero exit code:

1. identify the failed `sequence`
2. print a clear error
3. exit the current run as failure
4. do not pretend generation completed successfully

A later rerun can resume because existing clips are skipped by default.

Do not build automatic retry queues.

---

# 16. `clips_manifest.json`

Recommended structure:

```json
{
  "episode": "tbbt-s01e01",
  "source_video": "tbbt-s01e01.mkv",
  "video_duration_ms": 1278450,
  "padding": {
    "before_ms": 1500,
    "after_ms": 2000
  },
  "clips": [
    {
      "sequence": 1,
      "file": "clips/0001.mp4",
      "clip_start_ms": 880,
      "clip_end_ms": 6840,
      "duration_ms": 5960
    }
  ]
}
```

Rules:

- do not store subtitle text in this manifest
- do not store Supabase IDs
- do not store R2 URLs
- do not store signed URLs
- `sequence` is the join key back to Phase 2 `segments.json`

Phase 4 will combine:

```text
segments.json
+
clips_manifest.json
↓
join by sequence
↓
R2 upload + Supabase import
```

---

# 17. Validation Rules

`verify_clips.py` must at minimum verify:

- manifest loads successfully
- every listed clip exists
- each clip file size is greater than zero
- each clip duration is greater than zero
- FFprobe can read the generated MP4
- probed duration is close to manifest duration
- clip count matches manifest entries

Duration tolerance:

```text
±250 ms
```

Small encoding differences are acceptable.

This is not a frame-accurate editing system.

---

# 18. Manual Review

After full generation, manually inspect approximately 15 clips:

```text
first 3
middle 3
last 3
random 6
```

Check:

- correct dialogue is included
- beginning is not obviously cut off
- ending is not obviously cut off
- audio/video are synchronized
- playback works in a normal browser/player
- 1.5s before / 2.0s after feels acceptable

If clips generally feel too short or too long, change padding constants and regenerate.

Do not introduce sentence-merging logic unless actual playback proves padding insufficient.

---

# 19. Expected Test Coverage

Keep tests focused.

Suggested unit/integration cases:

1. clip boundary calculation with normal timestamps
2. start boundary clamps to zero
3. end boundary clamps to video duration
4. file naming uses four-digit sequence numbers
5. invalid segment timing fails clearly
6. missing source video fails clearly
7. missing `ffmpeg` fails clearly
8. missing `ffprobe` fails clearly
9. `--limit` limits selected segments
10. existing output is skipped by default
11. `--overwrite` regenerates existing output
12. manifest records expected timing fields
13. verifier detects missing file
14. verifier rejects zero/invalid duration
15. verifier accepts duration within tolerance

Do not mock an entire distributed media system.

---

# 20. Phase 2 Data Must Remain Immutable

Frozen rule:

> Phase 3 may read `segments.json`, but must never rewrite it.

Pipeline remains one-way:

```text
SRT
↓
segments.json            Phase 2
↓
clips + clip manifest    Phase 3
↓
R2 + Supabase            Phase 4
```

Each phase owns its own derived outputs.

---

# 21. Git Rules

Do not commit:

```text
data/raw/video/*.mkv
data/generated/**/clips/*.mp4
data/generated/**/clips_manifest.json
```

The existing `data/generated/` ignore rule should already protect generated output.

Commit only:

- Python source code
- tests
- docs
- other small text configuration required by the implementation

---

# 22. Definition of Done

Phase 3 is complete only when all are true:

- [ ] `ffmpeg` / `ffprobe` absence produces a clear error
- [ ] MKV is accepted directly as input
- [ ] one segment produces one MP4
- [ ] default padding is 1500 ms before / 2000 ms after
- [ ] start/end are clamped to valid video bounds
- [ ] output video is MP4 / H.264 / 480p
- [ ] output audio is AAC 96 kbps
- [ ] faststart is enabled
- [ ] subtitles are not burned into video
- [ ] cue merging is not implemented
- [ ] `--limit` works
- [ ] existing output is skipped by default
- [ ] `--overwrite` works
- [ ] `clips_manifest.json` is produced
- [ ] `verify_clips.py` validates all generated clips
- [ ] duration tolerance is approximately ±250 ms
- [ ] `segments.json` is not modified
- [ ] no Supabase access exists in Phase 3 scripts
- [ ] no R2 access exists in Phase 3 scripts
- [ ] generated media remains Git ignored
- [ ] test suite passes
- [ ] manual review of ~15 clips shows no obvious playback/timing problem

---

# 23. Frozen Phase 3 Decisions

| Decision | Value |
|---|---|
| Episode count | 1 |
| Source video | MKV |
| Clip unit | 1 segment = 1 clip |
| Before padding | 1500 ms |
| After padding | 2000 ms |
| Output container | MP4 |
| Video codec | H.264 |
| Resolution | 480p height |
| CRF | 28 |
| Preset | veryfast |
| Audio codec | AAC |
| Audio bitrate | 96 kbps |
| Faststart | Yes |
| Burn subtitles | No |
| Merge cues | No |
| Filename | `0001.mp4` |
| UUID | No |
| Supabase | No |
| R2 | No |
| Resume | skip existing |
| Force regeneration | `--overwrite` |
| Test generation | `--limit 5` |

These decisions should not be expanded during implementation unless a real local constraint makes one impossible.

---

# 24. Codex Execution Prompt

Use the following prompt for implementation:

```text
You are implementing Phase 3 of bbc-search.

Read first:
- AGENTS.md
- docs/IMPLEMENTATION_MANUAL.md
- docs/PHASE_2_CORPUS_PIPELINE.md
- docs/PHASE_3_CLIP_GENERATION.md
- existing scripts/corpus code and tests

Current state:
- Phase 2 is complete.
- The project uses exactly one episode.
- The local source video is MKV.
- Phase 2 produced segments.json.
- speaker remains null and is irrelevant to this phase.

Scope:
Implement the local media clip generation pipeline described in
`docs/PHASE_3_CLIP_GENERATION.md`.

Required implementation:
1. add scripts/corpus/generate_clips.py
2. add scripts/corpus/verify_clips.py
3. use ffprobe to read source video duration
4. use ffmpeg to create one MP4 per dialogue segment
5. use 1500 ms before padding and 2000 ms after padding
6. clamp boundaries to 0 and source duration
7. output H.264/AAC 480p MP4 with faststart
8. support --limit
9. skip existing clips by default
10. support --overwrite
11. generate clips_manifest.json
12. add focused automated tests
13. do not modify segments.json

Do not implement:
- Supabase upload/import
- Cloudflare R2 upload
- signed URLs
- database IDs
- subtitle burn-in
- cue merging
- sentence detection
- speaker inference
- online FFmpeg APIs
- background queues
- multi-episode abstractions beyond what is trivially required by the existing episode argument

Before coding:
1. inspect the current repository
2. inspect the actual Phase 2 JSON format
3. summarize your implementation plan
4. identify files to create/change
5. verify there is no conflict with existing Git ignore rules

Then implement.

After implementation:
1. run Python tests
2. run existing project lint/build if your changes can affect them
3. if ffmpeg/ffprobe exist locally, run a safe --limit 5 generation against the real local episode only if the files are available
4. run clip verification for those test clips if generated
5. do not upload media anywhere
6. summarize changed files
7. report commands the user must run locally for full generation
8. report any assumptions or local-tool limitations
9. do not expand scope without approval
```
