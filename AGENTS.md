# nuclear-diffusion-studio

Canonical entry document for this project.
`CLAUDE.md` delegates here, so read this first.

## Shared Memory Workspace

Use `../../wiki/index.md` as shared long-term memory when relevant; follow only relevant links and its write workflow for durable facts, decisions, and relationships. This project's files remain authoritative for current project state.

## What this is

A web app for running inference on the AIMS Lab's fine-tuned SDXL model (`kumo24/sdxl_nuclear`, from the NuclearDiffusion paper, arXiv:2608.04030).
Users write a prompt, the model renders nuclear-engineering images, and the studio keeps them in threads with their seeds and parameters.

The build is **frontend-first**: the full UI runs against a mock inference layer, and the Python GPU service is added later behind a frozen contract.
The plan lives in `docs/IMPLEMENTATION_PLAN.md`; the contract is `docs/API.md` and `frontend/lib/contract.ts`.

## Layout

- `frontend/` - Next.js 16 (App Router) + TypeScript + Tailwind v4 + shadcn/ui (Radix). Built first.
  - `app/api/generate/route.ts` - the one seam: mock engine when `INFERENCE_API_URL` is unset, proxy when set.
  - `lib/contract.ts` - the frozen request/stream contract (zod), shared by client, mock, and proxy.
  - `lib/mock/` - deterministic mock engine and procedural placeholder renderer.
  - `lib/server/` - NDJSON response helpers and the upstream proxy.
  - `lib/studio-state.ts` - the pure studio reducer (threads, turns, the running generation); `lib/storage.ts` - IndexedDB and localStorage persistence.
  - `components/studio/` - the studio UI: sidebar, feed, composer, run settings, explore, lightbox.
  - `tests/unit/` (Vitest) and `tests/e2e/` (Playwright).
- `backend/` - FastAPI + diffusers inference service, deployed on Modal via `deploy/modal_app.py`. Not built yet (Track B).

## Commands

Run from `frontend/`:

- `npm run dev` - dev server on :3000. Append `?mock=cold-start`, `?mock=inference-error`, or `?mock=slow` to the URL to force a mock scenario.
- `npm run check` - typecheck, lint, unit tests, then E2E. Run it before calling work done.
- `npm run test` / `npm run test:e2e` - either suite alone. E2E builds and serves production on :3200 and runs desktop Chromium, desktop WebKit, and a mobile viewport.

## Rules

- Protect secrets, always. Never print, log, commit, or pass a secret value on a command line.
  `INFERENCE_API_TOKEN` lives only in gitignored `frontend/.env.local` (mode 600), the Modal secret `nuclear-diffusion-studio`, and later Vercel env vars marked Sensitive.
  Create or rotate Modal secrets with `modal secret create --from-json <temp file>` and delete the temp file after; check values by comparing hashes, never by displaying them.
  The backend compares tokens in constant time and never logs the `Authorization` header.
- Serverless only. The GPU never runs 24/7: `min_containers` stays 0 (even for demos), and the Modal workspace budget ($30) and spend limit ($0) are the hard cost ceiling. Do not raise either without asking.
- The contract is frozen. Change `lib/contract.ts`, `docs/API.md`, the mock, and the proxy together, or not at all.
- Offer only settings the model supports. It is a fine-tuned SDXL UNet in the stock SDXL pipeline; `docs/API.md` ("What the model supports") lists the limits and why. Check the model card before adding a knob.
- The mock must stay faithful to the contract: every UI state has to be reachable without a backend.
- The visual base is `Studio v2.dc.html` in the Claude Design project "AI Inference Frontend Console": monochrome on true black with one accent, Cherenkov blue, used only for the primary action, selected controls, and generation progress; amber only for alerts. IBM Plex Sans for the UI, Plex Mono only for data. Iterate on it with `/impeccable`; do not introduce further accent colors.
- `frontend/AGENTS.md` is written by `next dev`: read it, because this Next.js version differs from older training data, and read the bundled docs in `node_modules/next/dist/docs/` before using an unfamiliar API.

## Git model

Standalone repository under the `aims/` group folder.
Remote: none yet; intended `jere67/nuclear-diffusion-studio`.
Commit only from inside this repository, never from the outer workspace.

## Inherited guidelines

- Never use the em dash. Use a plain dash instead.
- Never auto-add an agent as a commit co-author.
- Reproduce bugs end-to-end before fixing them.
- Be pixel-perfect on UI, and fix lint, test failures, and flakiness you notice.
