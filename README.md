# NuclearDiffusion Studio

A web studio for generating nuclear-engineering imagery with the AIMS Lab's fine-tuned SDXL model, [`kumo24/sdxl_nuclear`](https://huggingface.co/kumo24/sdxl_nuclear), from the NuclearDiffusion paper ([arXiv:2608.04030](https://arxiv.org/abs/2608.04030)).

Write a prompt, pick an aspect ratio and how many images to make, tune steps, guidance, seed, and a negative prompt, and watch each image denoise with live step-by-step progress.
Generations are organised into threads, like a chat history, and saved in the browser.
Every image keeps its seed and parameters, so it can be reproduced, varied, or downloaded.
The settings offered are the ones the model actually supports; see "What the model supports" in [`docs/API.md`](docs/API.md).

## Status

The studio runs end to end against the real model.
The inference service in `backend/` is deployed on [Modal](https://modal.com) as a scale-to-zero GPU app (`deploy/modal_app.py`): it costs nothing while idle, and a request after a quiet spell waits about 30 seconds while a GPU wakes up.
Without `INFERENCE_API_URL`, the frontend falls back to a built-in **mock inference layer** that returns labelled placeholder images, so the UI can be developed with no GPU at all.

## Quick start

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000.
To see the failure states, add `?mock=cold-start` or `?mock=inference-error` to the URL.

## Connecting the real model

Set these in `frontend/.env.local` (gitignored; ask a maintainer for the token):

```bash
INFERENCE_API_URL=https://jeremoon--nuclear-diffusion-studio-inference-web.modal.run
INFERENCE_API_TOKEN=<Modal proxy token, as id.secret>
```

The `/api/generate` route handler then proxies to that service instead of serving the mock.
The service implements the contract in [`docs/API.md`](docs/API.md); `AGENTS.md` lists the backend's test, deploy, and benchmark commands.

## Development

| Command (in `frontend/`) | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run check` | Typecheck, lint, unit tests, and E2E |
| `npm run test` | Vitest unit tests |
| `npm run test:e2e` | Playwright on desktop Chromium, desktop WebKit, and mobile |

Stack: Next.js 16, React 19, TypeScript, Tailwind CSS v4, shadcn/ui (Radix), zod, Vitest, Playwright.

See [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) for the full plan and roadmap.
