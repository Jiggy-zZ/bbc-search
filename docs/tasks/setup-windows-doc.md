# Task: Create a complete Windows setup guide

## Goal
Create `docs/setup_windows.md` as a complete, copyable guide for setting up BBC Search on a new Windows machine from zero to a verified working state.

The guide is intended for future cross-device recovery without relying on prior chat history.

## Source of truth
Use the current repository state as the authority, especially:
- `package.json`
- `package-lock.json`
- `.env.example`
- `.gitignore`
- `bootstrap.ps1`
- `README.md`
- current scripts and implementation docs

Do not infer setup from earlier phase assumptions when the repository has since changed.

## Required content
The guide must be procedural and explicit.

Cover at least:

1. Machine prerequisites actually used by BBC Search
   - Git / GitHub access
   - Node.js / npm
   - FFmpeg / FFprobe
   - any Python requirement only if current active scripts truly require it
   - browser/runtime prerequisites if materially needed

2. What to open
   - normal PowerShell / Windows Terminal
   - where commands should be run
   - how to verify Node/npm/FFmpeg/FFprobe are available

3. Clone / repository preparation
   - concrete commands with placeholders instead of machine-specific absolute paths
   - entering repository root

4. Install project dependencies
   - use the lockfile-aware npm command appropriate for a clean clone
   - explain the normal command for later dependency refresh only if useful
   - do not substitute unrelated package managers

5. Local environment variables
   - create `.env` from `.env.example`
   - explain each current variable at a practical level
   - never include real keys, tokens, service-role secrets, or account IDs
   - explain that `.env` is local/ignored

6. Media tooling
   - verify `ffmpeg` and `ffprobe`
   - explain their role in clip generation / inspection
   - do not treat them as npm dependencies

7. Readiness verification
   - run `./bootstrap.ps1` from repository root
   - explain required vs missing-local-config checks

8. Project verification
   - current lint/test/build commands as supported by `package.json`
   - development startup command
   - explain expected local URL only if it is current and confirmed

9. Reopening the project later
   - minimal future startup sequence after one-time setup

10. Troubleshooting
   - `node` / `npm` not found
   - `ffmpeg` / `ffprobe` not found
   - `node_modules` absent or stale
   - `.env` missing
   - build/test failure caused by missing external credentials

## Boundaries
- Do not expand product scope or phase scope.
- Do not add raw copyrighted media, SRT files, generated clips, or secrets to Git.
- Do not turn FFmpeg into an npm dependency.
- Do not add a Python environment unless active code actually requires one.
- Do not make `bootstrap.ps1` install packages, media tools, or secrets.

## Documentation quality
- Prefer exact commands over abstract prose.
- State shell/location assumptions.
- Use placeholders for local values and credentials.
- Separate one-time setup from ordinary later startup.
- Keep the guide aligned with current `package.json` scripts and repository structure.

## Acceptance criteria
The task is complete when:
- `docs/setup_windows.md` exists.
- A new Windows machine can be configured for BBC Search from the guide without prior memory.
- npm commands match the current lockfile/package model.
- FFmpeg/FFprobe remain documented as machine prerequisites.
- `.env` setup is clear and contains no real secrets.
- `bootstrap.ps1` remains check/report only.
- README or related docs are updated only where useful to point to the guide.
