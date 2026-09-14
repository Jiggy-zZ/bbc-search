# BBC Search Agent Notes

## Project context

BBC Search is a small AI-coding practice project for bilingual subtitle search and corresponding clip playback/sharing. Keep implementation aligned with the current phase and repository documentation rather than expanding scope by default.

## Working boundary

- Use the current repository docs as the primary project context.
- Design exploration is allowed: propose alternatives, question existing implementation choices, and suggest simpler approaches when useful.
- Do not silently change the intended product scope or phase goals while implementing another task.
- For changes that materially alter data shape, storage contracts, or phase boundaries, make the intended final state explicit before editing.
- Raw copyrighted video, subtitle source files, generated clips, and secrets stay outside GitHub.

## Engineering

- Prefer existing repository structure and conventions unless there is a clear reason to improve them.
- Keep machine-specific values and secrets out of tracked files.
- Validate changes with the relevant tests or checks when possible.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
