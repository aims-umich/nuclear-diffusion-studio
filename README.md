# NuclearDiffusion Studio

A web studio for generating nuclear-engineering imagery with the AIMS Lab's fine-tuned SDXL model, [`kumo24/sdxl_nuclear`](https://huggingface.co/kumo24/sdxl_nuclear), from the NuclearDiffusion paper ([arXiv:2608.04030](https://arxiv.org/abs/2608.04030)).

Write a prompt, pick an aspect ratio and how many images to make, tune steps, guidance, seed, and a negative prompt, and watch each image denoise with live step-by-step progress.
Generations are organised into threads, like a chat history, and saved in the browser.
Every image keeps its seed and parameters, so it can be reproduced, varied, or downloaded.
The settings offered are the ones the model actually supports; see "What the model supports" in [`docs/API.md`](docs/API.md).

## Status

The frontend is complete and runs against a **mock inference layer**, which returns a labelled procedural placeholder instead of model output.
The Python GPU inference service is the next track; the UI switches to it with one environment variable and no code changes.

## Quick start

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000.
To see the failure states, add `?mock=cold-start` or `?mock=inference-error` to the URL.

## Connecting the real model

Build the inference service to the contract in [`docs/API.md`](docs/API.md), then set:

```bash
INFERENCE_API_URL=https://your-inference-service.example.com
INFERENCE_API_TOKEN=optional-bearer-token
```

The `/api/generate` route handler then proxies to that service instead of serving the mock.

## Development

| Command (in `frontend/`) | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run check` | Typecheck, lint, unit tests, and E2E |
| `npm run test` | Vitest unit tests |
| `npm run test:e2e` | Playwright on desktop Chromium, desktop WebKit, and mobile |

Stack: Next.js 16, React 19, TypeScript, Tailwind CSS v4, shadcn/ui (Radix), zod, Vitest, Playwright.

See [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) for the full plan and roadmap.
