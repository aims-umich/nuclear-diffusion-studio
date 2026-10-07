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
- `backend/` - FastAPI + diffusers inference service (Track B), runnable under plain uvicorn on any GPU host.
  - `app/main.py` - `create_app(engine, token, limiter)`: `POST /generate`, NDJSON streaming, bearer auth, per-IP rate limit.
  - `app/pipeline.py` - the real engine (fine-tuned UNet in the stock SDXL pipeline); `app/weights.py` - pinned revisions and the build-time download.
  - `requirements.in` -> `requirements.txt` (compiled lock, installed in the Modal image); `requirements-dev.txt` - local tooling, no torch.
  - `tests/` - pytest against a fake engine, CPU only.
- `deploy/` - `modal_app.py` wraps `backend/` as a scale-to-zero Modal app; `benchmark.py` times candidate GPUs.
  Deployed at `https://jeremoon--nuclear-diffusion-studio-inference-web.modal.run` (Modal proxy auth: requests without the token never reach a GPU).

## Commands

Run from `frontend/`:

- `npm run dev` - dev server on :3000. Append `?mock=cold-start`, `?mock=waking`, `?mock=inference-error`, or `?mock=slow` to the URL to force a mock scenario.
- `npm run check` - typecheck, lint, unit tests, then E2E. Run it before calling work done.
- `npm run test` / `npm run test:e2e` - either suite alone. E2E builds and serves production on :3200 and runs desktop Chromium, desktop WebKit, and a mobile viewport.

With `INFERENCE_API_URL` and `INFERENCE_API_TOKEN` in `frontend/.env.local`, `npm run dev` uses the real model on Modal; remove `INFERENCE_API_URL` to go back to the mock.

Run from the project root, with `backend/.venv` (`python3 -m venv backend/.venv && backend/.venv/bin/pip install -r backend/requirements-dev.txt`):

- `backend/.venv/bin/python -m pytest backend` - the backend suite (CPU, no GPU or torch needed).
- `backend/.venv/bin/modal deploy deploy/modal_app.py` - deploy. Then send one request yourself: the first one after a deploy builds the memory snapshot.
- `backend/.venv/bin/modal run deploy/benchmark.py` - time L4, A10 and L40S on the real pipeline (spends a few cents of credit).
- After editing `backend/requirements.in`: `backend/.venv/bin/uv pip compile backend/requirements.in -o backend/requirements.txt --python-version 3.12 --python-platform x86_64-manylinux_2_28`.

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
