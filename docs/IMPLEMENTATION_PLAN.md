# NuclearDiffusion Studio - Implementation Plan

An end-to-end plan for a deployable web app that runs inference on the AIMS Lab's fine-tuned SDXL model (`kumo24/sdxl_nuclear`).
Users type a prompt, the fine-tuned model generates a nuclear-domain image, and the app displays it in a polished, on-theme interface.

> Working name: **NuclearDiffusion Studio** (matches the lab's NuclearDiffusion paper).
> Proposed home: a new fourth project under `aims/`, its own git repo (`jere67/nuclear-diffusion-studio`), consistent with `aims-website`, `dashboard`, and `genai-image-parser`.

> **Build order (decided):** the frontend is built first against a mock inference layer, so UI velocity is never blocked on GPU/backend readiness.
> The Python inference service is wired in later, behind a fixed API contract, so the real backend drops in without reworking the UI.
> Before any code, the interface is sketched with the `design` skill for sign-off (see Section 7).

> **Status (2026-09-22):** Track A phases 0-3 are implemented in `aims/nuclear-diffusion-studio/frontend` (local repo, no remote yet).
> The console runs end to end against the mock, with 57 unit tests and 41 E2E tests passing across desktop Chromium, desktop WebKit, and mobile.
> Next: Phase 4 (create the GitHub remote and deploy to Vercel), which needs Jeremy's go-ahead, then Track B.
> Deviations from the original text are recorded inline as **As built** notes.

---

## 1. Goals and non-goals

**Goals**

- Let any user enter a text prompt and get back an image from the fine-tuned model.
- Expose the tunable knobs that matter for SDXL (negative prompt, steps, guidance scale, seed, size) without overwhelming a casual user.
- Look genuinely great: a modern, "nuclear"-themed interface that feels like a research product, not a template. Tasteful, not gimmicky.
- Be deployable so the lab can share a public URL, and be maintainable by the team long term.

**Non-goals (v1)**

- No training or fine-tuning in the app; it is inference-only.
- No user accounts or auth in v1 (can add later behind a feature flag).
- No image editing / inpainting / img2img in v1 (natural v2 extensions).

---

## 2. The critical fact about the model

`kumo24/sdxl_nuclear` is **a fine-tuned SDXL UNet**, not a full pipeline and not a LoRA.
This has three consequences that shape everything below:

1. **It must be composed with the base model at load time.**
   You load the custom UNet and inject it into the standard SDXL base pipeline:

   ```python
   import torch
   from diffusers import DiffusionPipeline, UNet2DConditionModel

   unet = UNet2DConditionModel.from_pretrained(
       "kumo24/sdxl_nuclear", torch_dtype=torch.float16
   )
   pipe = DiffusionPipeline.from_pretrained(
       "stabilityai/stable-diffusion-xl-base-1.0",
       unet=unet,
       torch_dtype=torch.float16,
       variant="fp16",
   ).to("cuda")

   image = pipe(
       prompt="a pressurized water reactor containment building, technical diagram",
       negative_prompt="blurry, low quality",
       num_inference_steps=30,
       guidance_scale=7.5,
   ).images[0]
   ```

2. **It needs a GPU.** SDXL at fp16 wants roughly 10-16 GB of VRAM for comfortable inference.
   This is the single biggest architectural decision: where the GPU lives (see Section 5).

3. **The model is on the Hugging Face Hub under Apache 2.0**, downloaded on demand.
   The base SDXL weights (~7 GB) plus the custom UNet download on first load, so container images and cold starts must account for that.

A quick reproducibility step is worth doing before writing any app code: run the snippet above in a Colab or Kaggle GPU notebook, confirm the model loads and produces a sane nuclear-domain image, and record a few known-good prompts and parameter values.
Those become the app's defaults and the seed content for a prompt-gallery.

---

## 3. High-level architecture

Three logical pieces, cleanly separated so each can be deployed and scaled independently:

```
                                                              (GPU)
+-------------------+     +---------------------+         +---------------------------+
|   Next.js app     | --> |  Route handler      |  HTTPS  |   Inference service       |
|   (App Router,    |     |  /api/generate      | ------> |   FastAPI + diffusers      |
|    on Vercel)     | <-- |  proxy OR mock       | <------ |   loads base SDXL + custom |
+-------------------+     +---------------------+ (+prog) |   UNet, runs the pipeline  |
        |                    |                            +---------------------------+
        | console, gallery   | in frontend-first phase:            |
        v                    | returns placeholder images          | writes generated images
   User's browser            | + fake seed/timing/states           v
                                                        Object storage (optional)
                                                        (S3 / R2 / Supabase Storage)
```

- **Frontend**: a Next.js App Router app on Vercel. No inference secrets in the client. It calls its own `/api/generate` route handler.
- **Route handler (`/api/generate`)**: a thin server-side seam. In the frontend-first phase it *is* a mock that returns placeholder images plus a realistic seed, timing, and state simulation; once the backend exists it becomes a proxy to the Python service (keeping any tokens server-side). The client contract never changes between the two.
- **Inference service**: the only GPU-bound component. Owns model loading, the pipeline, request validation, and (optionally) persistence of generated images. Built and wired in *after* the frontend.
- **Storage (optional in v1)**: if you want a persistent gallery of past generations or shareable permalinks, write PNGs to object storage and return URLs. For a pure "generate and show" v1 you can skip this and return the image inline as base64 or a short-lived blob.

Keeping the inference service behind a narrow HTTP contract - proxied through the Next.js route handler - means the frontend is written and shipped against the mock, and the real GPU backend drops in later with zero client changes. The same contract can also power a CLI, a Slack bot, or batch jobs.

---

## 4. Tech stack

Chosen to match what the lab already runs (see `aims/dashboard`), so the team can maintain it without learning new tools.

**Frontend**

Mirrors `aims-website` (Next.js App Router + TypeScript + Tailwind) so the team maintains one stack, but on the latest stable versions of everything.

- **Next.js (latest stable, App Router)** + TypeScript - same framework as `aims-website`.
- **Tailwind CSS v4** for styling, with design tokens for the nuclear theme.
- **shadcn/ui** (Radix primitives + Tailwind under the hood) as the accessible component base: sliders, dialogs, tooltips, inputs, popovers. This is the workhorse library and keeps every control keyboard- and screen-reader-friendly for free.
- **Aceternity UI / Magic UI** for high-polish, low-effort hero and background effects (spotlight, aurora/beams, animated grid, shimmer) - used sparingly for the "instrument" feel, not everywhere.
- **motion** (framer-motion) for choreographed animation (reactor-glow, generation shimmer, result reveal).
- **`lucide-react`** / **`@tabler/icons-react`** for iconography.
- **Vercel Analytics** (already used on `aims-website`).
- Deploy on **Vercel** (same as `aims-website`).

All component libraries above are open source and installed by copying components into the repo (shadcn/ui, Aceternity, Magic UI all follow the copy-in model), so there is no heavy runtime dependency and every component is fully editable to fit the theme.

> **As built:** shadcn/ui (slider, toggle group, sonner toasts) and `lucide-react` are in; Aceternity UI, Magic UI, and `motion` are not.
> The bare-bones monochrome base has no hero or background effects, and its motion (progress shimmer, breathing glow, result reveal) is three CSS keyframes, so those libraries would add weight without earning it.
> They remain options for later `/impeccable` passes if a surface calls for them. Vercel Analytics arrives with the Phase 4 deploy.

**Inference backend**

- Python + FastAPI (same as `dashboard/backend`)
- `diffusers`, `transformers`, `accelerate`, `torch` (CUDA build)
- `Pillow` for image encoding
- Pydantic models for request/response validation
- Uvicorn server, containerized with a CUDA base image

**Why not do inference in Next.js / Node?**
The model ecosystem is Python-only (`diffusers`), and the lab's ML code is already Python.
A separate Python service is simpler and more robust than trying to bridge into Node.
Next.js still earns its place: its `/api/generate` route handler is the server-side seam that hosts the mock during frontend-first development and later proxies to the Python service, keeping any HF/storage tokens off the client.

---

## 5. Where the GPU lives (the key decision)

The frontend is trivial to host. The real choice is how to serve GPU inference.
Four viable options, roughly ordered from least to most operational overhead:

| Option | How it works | Pros | Cons | Best when |
| --- | --- | --- | --- | --- |
| **Modal** (recommended) | Wrap the pipeline in a Modal function with a GPU decorator; Modal gives an autoscaling HTTPS endpoint, scale-to-zero | Python-native, minimal DevOps, pay-per-second, scales to zero when idle, easy to keep the model warm | Cold starts (~20-40s) unless you keep a container warm; another vendor | You want a real public deployment with low idle cost |
| **Hugging Face Inference Endpoints** | Deploy the model on HF with a **custom `handler.py`** that composes base SDXL + the custom UNet | Model already lives on HF; managed autoscaling; natural fit | Needs a custom handler (the default SDXL handler won't load a UNet-only repo); can be pricey if always-on | You want everything in the HF ecosystem |
| **Replicate** | Package the pipeline with Cog, push a model, call its HTTP API | Dead-simple client API, handles queueing, good for demos | Less control; per-prediction pricing; cold starts | You want the fastest path to a shareable link |
| **Self-hosted GPU** (lab machine or RunPod / Lambda / a cloud GPU VM) | Run the FastAPI container directly on a GPU box | Full control, zero marginal cost on lab hardware, no cold starts if always-on | You own uptime, scaling, and security; idle cost if cloud | The lab already has a GPU server, or cost must be zero |

**Recommendation:** build the FastAPI service so it is deployment-agnostic, then:

- **For the public demo:** deploy on **Modal** (or Replicate for the absolute fastest link). Both give autoscaling and scale-to-zero, so idle cost is near zero and you get a stable HTTPS URL for the frontend.
- **For zero-cost / internal use:** run the identical container on a **lab GPU** if one is available.

The important design principle: **the same FastAPI + diffusers code runs in all of these.**
Modal and Replicate just wrap it; a lab box runs it directly.
So you never rewrite inference logic when the hosting decision changes.

---

## 6. Inference service design

**Model loading (once, at startup / container warm)**

- Load base SDXL + custom UNet in fp16 on CUDA.
- Apply memory/speed optimizations: `enable_xformers_memory_efficient_attention()` or torch SDPA, optional `enable_model_cpu_offload()` if VRAM is tight, and consider `torch.compile` on the UNet for a speed boost after warmup.
- Load once into a module-level singleton so requests reuse the warm pipeline; never load per request.

**API contract (frozen)**

`POST /generate` - the full wire-level spec lives in `docs/API.md` in the repo, and the machine-readable source of truth is `frontend/lib/contract.ts`.

```jsonc
// request
{
  "prompt": "string (required, 1-500 chars)",
  "negative_prompt": "string (optional)",
  "num_inference_steps": 30,      // 10-50, default 30
  "guidance_scale": 7.5,          // 1-15, default 7.5
  "width": 1024,                  // 512 | 768 | 1024
  "height": 1024,
  "seed": 12345                   // optional uint32; omit for random
}
```

A successful response is an `application/x-ndjson` stream: `accepted` first, one `progress` per denoising step, then exactly one `result` or `error`.

```jsonc
{"type":"accepted","seed":12345,"total_steps":30,"model":"kumo24/sdxl_nuclear"}
{"type":"progress","step":1,"total_steps":30}
{"type":"result","image":"data:image/png;base64,...","seed":12345,"params":{...,"scheduler":"euler_a"},"timing_ms":4200,"model":"kumo24/sdxl_nuclear"}
```

Non-2xx responses carry `{"error":{"code","message","retry_after_s?"}}`; a warming model returns `503` + `Retry-After` (`ERR_COLD_START`).

> **As built:** the contract streams progress from day one instead of returning one JSON body, because the base design centres on a live step counter and percentage.
> A backend that cannot stream yet may still return the original single-JSON shape; the Next.js proxy converts it into `accepted` + `result`, so the UI keeps working (just without step progress).

**Concurrency and latency**

- A single GPU processes one image at a time; SDXL at 30 steps is ~3-8s on an A10G/A100 once warm.
- Serialize GPU access with a lock or a small in-process queue so concurrent requests don't collide on the device.
- Set generous client and server timeouts (60-120s) to survive cold starts and queueing.
- Consider a job model (`POST /generate` returns a `job_id`, client polls `GET /jobs/{id}`) if you expect bursts; for a v1 demo, a synchronous request with a loading state is simpler and fine.

**Progress feedback (part of the contract)**

- `diffusers` supports a per-step callback (`callback_on_step_end`); emit one `progress` NDJSON line per step.
- NDJSON over a plain streamed POST is used rather than SSE or WebSockets: it needs no extra protocol and passes through the Next.js proxy unchanged.

**Safety / abuse**

- Rate-limit by IP (the GPU is the scarce resource).
- Cap prompt length and reject empty prompts.
- Optionally run a lightweight NSFW/safety check on outputs before returning; note it's a research/domain model, so scope this to your risk tolerance.

---

## 7. Frontend design - "nuclear" without being loud

Design direction: **precise, technical, and quietly energetic.**
Think research instrument and clean control room, not radioactive-green cliches.
A visual sketch of this console is produced with the `design` skill for sign-off *before* implementation (see Phase 0 in the roadmap); the `frontend-design` skill guides the actual build for a distinctive, non-templated result.

**Art direction**

- **Palette:** deep graphite / near-black base (control-room dark), cool steel grays, with a single restrained accent - a Cherenkov-style electric cyan-blue, used sparingly for the primary action, focus rings, and the "charging" glow. A warning-amber as a secondary accent for alerts only. Avoid saturated hazard-green everywhere; a hint goes a long way.
- **Typography:** a clean geometric or grotesk sans for UI (e.g. Inter, Geist, or Space Grotesk) paired with a monospace (e.g. JetBrains Mono) for parameter readouts and the seed value - the mono gives it the instrument feel.
- **Texture / motif:** subtle. A faint hex/lattice grid, thin concentric "containment" rings behind the hero, a soft radial glow that intensifies while generating. Keep motion physical and smooth, never flashy.
- **Layout:** a focused generation console. Prompt input front and center, an "Advanced controls" panel (collapsible) for steps/guidance/seed/size, and a large result stage. On desktop, a two-column split (controls left, result right); stacked on mobile.

**Key UI states**

- **Idle:** big prompt field, example-prompt chips (seeded from your known-good prompts), primary "Generate" button with a subtle pulse.
- **Generating:** result stage shows a charging/scanline/glow animation; if progress streaming is wired up, a real progress bar; controls disabled.
- **Result:** image reveals with a smooth fade/scale; show the prompt, the seed, and the params used; actions: Download, Copy seed, "Use as base for a variation" (re-run with same seed), Regenerate.
- **Error:** clear, on-theme message (e.g. "Reactor offline - the model is warming up, try again in a moment") distinguishing cold-start vs. real failure.

**Components**

- Prompt box with example chips and a character counter.
- Advanced controls: sliders (steps, guidance), seed input with a randomize/dice button, size selector.
- Result card with metadata and action row.
- Optional session gallery: a strip of this session's generations (in-memory or `localStorage`); a persistent gallery needs the storage layer from Section 3.

**Accessibility & responsiveness**

- Full keyboard support, visible focus states, proper labels on every control (use Radix primitives).
- Respect `prefers-reduced-motion` - drop the heavy glow/scanline animations for those users.
- Works cleanly at phone width with no horizontal scroll.

**Base design source (decided)**

The base design is not built from scratch: it comes from a Claude Design project Jeremy iterated on, a simple, bare-bones layout of the inference console.
That project is imported via the Claude Design MCP and its `Inference Console.dc.html` is the starting point the Next.js UI is built from.
The exact prompt below is used verbatim to set up the base design at the start of the frontend build (Phase 1); the earlier `design`-skill mockup in this plan is a directional reference, while this Claude Design project is the authoritative base layout.

```text
Use the claude_design MCP (https://api.anthropic.com/v1/design/mcp, auth via /design-login) to import this project:
https://claude.ai/design/p/dd0f1479-3a31-464f-a7be-1e2e305d3fda?file=Inference+Console.dc.html

Focus on these files (the whole project is readable):
- `Inference Console.dc.html`

Also read these files the selection imports:
- `support.js`

Implement: `Inference Console.dc.html`
```

Notes for when implementation begins:

- Authenticate the Claude Design MCP first with `/design-login` before running the import.
- Read `Inference Console.dc.html` and the `support.js` it imports, then translate that layout into the Next.js + Tailwind + shadcn/ui structure (Section 8) rather than pasting raw markup - keep the design's layout and hierarchy, adapt it to real components and the nuclear theme tokens.
- The imported design defines the base; the states, mock wiring, and polish from Sections 6-7 and the roadmap layer on top of it.

---

## 8. Repository layout

A single repo with a clear frontend/backend split, mirroring `aims/dashboard`:

```
nuclear-diffusion-studio/
  AGENTS.md            # canonical entry doc, bridges to ../../wiki/index.md
  CLAUDE.md            # delegates to AGENTS.md
  README.md
  LICENSE
  frontend/            # Next.js (App Router) + TypeScript + Tailwind app  <- built first
    app/
      page.tsx         # the generation console
      layout.tsx
      api/
        generate/
          route.ts     # mock in frontend-first phase, then proxy to backend
    components/
      ui/              # shadcn/ui components (copied in)
      console/         # prompt box, controls, result stage, gallery
    lib/
      api.ts           # typed client for /api/generate (contract lives here)
      mock/            # placeholder images + fake seed/timing/state generator
    app/globals.css    # Tailwind v4 theme tokens (no tailwind.config in v4)
    tests/unit/        # Vitest: contract, mock engine, reducer, client, route (both modes)
    tests/e2e/         # Playwright: desktop Chromium, desktop WebKit, mobile
    package.json
    .env.local         # INFERENCE_API_URL (unset => route handler serves the mock)
  backend/             # FastAPI + diffusers inference service  <- added later (Track B)
    app/
      main.py          # FastAPI app, routes
      pipeline.py      # model loading + generate()
      schemas.py       # pydantic request/response models (match frontend contract)
    requirements.txt
    Dockerfile         # CUDA base image
  deploy/
    modal_app.py       # Modal wrapper (or replicate cog.yaml / handler.py)
  docs/
    IMPLEMENTATION_PLAN.md   # this document, moved in on project creation
```

---

## 9. Phased roadmap

The roadmap is deliberately **frontend-first**: the entire UI is designed, built, and deployed against a mock inference layer before any GPU or Python work happens.
The API contract (Section 6) is frozen up front so the mock and the real backend are drop-in interchangeable.
Phases 0-4 need no GPU, no Python, and no model access; phases 5-7 wire in the real thing whenever it is ready.

### Track A - Frontend (do this first, no backend needed)

**Phase 0 - Design sketch & sign-off (half a day)** - done

- Produce a visual mockup of the generation console with the `design` skill (art direction, theme tokens, all key UI states).
- Review with Jeremy, lock the look and the palette/typography tokens.
- Freeze the `/api/generate` request/response contract (Section 6) so the mock and real backend match exactly.

**Phase 1 - Scaffold & design system (half a day)** - done

- Scaffold Next.js (latest, App Router) + TypeScript + Tailwind v4, matching `aims-website` conventions.
- **Import the base design** from the Claude Design project via the Claude Design MCP, using the exact prompt recorded in Section 7 ("Base design source"): authenticate with `/design-login`, import the project, read `Inference Console.dc.html` + `support.js`, and translate that layout into the component structure.
- Install shadcn/ui; pull in the chosen Aceternity/Magic UI effects.
- Wire the nuclear theme: color tokens, fonts (UI sans + mono), dark control-room base.

**Phase 2 - Generation console against the mock (2-4 days)** - done

- Build the `/api/generate` **route handler as a mock**: accepts the real request shape, returns a placeholder image (a curated set of on-theme sample images or a generated placeholder) plus a realistic seed, `timing_ms`, and echoed params.
- Have the mock simulate real behavior: artificial latency, a "cold start" delay, and occasional errors, so every UI state is exercised without a backend.
- Build the console: prompt box with example chips, advanced controls (steps/guidance/seed/size), result stage, and all states (idle / generating / result / error).
- Session gallery, download, copy-seed, regenerate - all working end-to-end against the mock.
- The target here is a **complete, functional, bare-bones frontend** - correct structure, states, and behavior, not final polish. That polish is Phase 3.

**Phase 3 - Elevate to production-ready with `/impeccable` (2-4 days, iterative)** - first polish pass done; keep iterating

- Once the bare-bones frontend from Phase 2 exists and works, use the **`/impeccable`** command **regularly and iteratively** to take it from functional to production-ready: visual hierarchy, spacing, typography, color, motion/micro-interactions, responsive behavior, empty/error states, and accessibility.
- Run `/impeccable` in passes rather than once - each pass targets a specific surface or concern (e.g. the result stage, the controls rail, the generating animation, mobile layout), reviewing and accepting changes incrementally.
- Keep the frozen API contract and the mock layer untouched; this phase reshapes the UI only, so it stays fully exercisable without a backend.
- Exit criterion: the console reads as a polished research product (per the Section 7 art direction), passes a pixel-perfect review, and holds up on desktop and mobile.

> **As built (Phases 1-3):**
> - Stack: Next.js 16.3 (App Router, Turbopack), React 19.2, Tailwind v4.3, shadcn/ui 4 on Radix, zod 4, Vitest 5, Playwright 1.63.
> - The Claude Design base is monochrome (black and white, amber only for alerts); it supersedes the cyan palette in Section 7 and the `design`-skill mockup.
> - Sizes follow the base design: square 512 / 768 / 1024.
> - The design's "Docs" / "API" nav links had no destination, so they became "Paper" (arXiv) and "Model" (Hugging Face).
> - The design's preview-state switcher is not shipped; `?mock=cold-start|inference-error|slow` reaches every state on demand instead.
> - Added beyond the base: Esc / Cancel during generation, Cmd/Ctrl+Enter, a live region for screen readers, auto-scroll to the output on stacked (phone) layouts, and a toast on copy/variation.
> - The mock renders a deterministic, clearly labelled "MOCK OUTPUT" reactor-core map from (seed, prompt), so fixed-seed reproducibility is testable before the real model exists.
> - First `/impeccable` polish pass fixed tablet layout balance, touch targets, glyph icons, hint contrast, scrollbar theming, toast placement, seed-badge anchoring, and added a result reveal.

**Phase 4 - Deploy the frontend (half a day)**

- Deploy to Vercel with the mock still active, so there is a shareable, fully interactive link immediately.
- Pixel-perfect review, empty/edge-case prompts, keyboard-only pass.
- Add Vercel Analytics.

### Track B - Inference backend (wire in when the model/GPU is ready)

**Phase 5 - Validate the model (half a day)**

- Run the load+generate snippet (Section 2) in a GPU notebook.
- Confirm image quality, capture 6-10 strong example prompts and good default params (these replace the placeholder sample images and seed the example chips).
- Decide GPU host (Section 5).

**Phase 6 - Inference service (1-2 days)**

- FastAPI app with `POST /generate`, pydantic validation matching the frozen contract, warm singleton pipeline, GPU lock.
- Dockerfile on a CUDA base image; verify it runs locally on a GPU (or on the chosen host).
- Return base64 PNG + seed + timing. Add basic rate limiting.

**Phase 7 - Deploy backend & flip the switch (1 day)**

- Wrap in Modal (or push to Replicate / deploy to the lab GPU); get a stable HTTPS endpoint; tune keep-warm.
- Flip the Next.js route handler from **mock to proxy** by setting the `INFERENCE_API_URL` env var - no client-side changes.
- Lock CORS on the backend to the Vercel origin(s) plus localhost.
- Final QA: real end-to-end runs, latency check, cold-start handling.

**Phase 8 (optional, v2) - persistence & extras**

- Object storage for a persistent, shareable gallery with permalinks.
- Progress streaming (SSE/WebSocket) for a real progress bar.
- img2img / variations, prompt presets, batch generation, light auth.

---

## 10. Deployment & ops summary

- **Frontend:** Next.js on Vercel (same as `aims-website`). Ships first with the mock route handler active, so there is a live link before any backend exists.
- **The flip:** setting `INFERENCE_API_URL` switches the `/api/generate` route handler from mock to proxy - the one config change that turns the demo real. Unset, it serves the mock.
- **Backend:** container on Modal (autoscale, scale-to-zero) or a lab GPU (always-on). Keep at least one warm instance if cold starts hurt the demo.
- **Secrets:** none needed in the client; any HF token or storage keys live only in the route handler / backend environment.
- **CORS:** restrict the backend to the Vercel origin(s) plus localhost for dev.
- **Monitoring:** log generation timings and failures; watch GPU cost and cold-start frequency.

---

## 11. Cost notes

- **Serverless GPU (Modal/Replicate):** you pay per second of GPU time. A few seconds per image plus occasional warm-keeping. Cheap at demo/low traffic; scales with usage. Scale-to-zero means near-zero idle cost.
- **Always-on cloud GPU:** predictable but you pay 24/7 whether used or not - only worth it at steady traffic.
- **Lab GPU:** zero marginal cost, but you own uptime and exposure to the public internet (put it behind the FastAPI service with rate limiting, and ideally a reverse proxy).

---

## 12. Open questions for Jeremy

1. **GPU hosting:** does the lab have a GPU server we can deploy on, or should this target a serverless GPU platform (Modal/Replicate) for the public demo?
2. **Audience & traffic:** internal lab tool, or a public link that could see real traffic? This sets how hard we harden rate limiting and cold-start handling.
3. **Persistence:** do we want a saved, shareable gallery of generations (needs object storage), or is a per-session gallery enough for v1?
4. **Repo:** create `nuclear-diffusion-studio` as a new fourth `aims/` project with its own `jere67` remote, following the group's conventions?
5. **Branding:** any existing AIMS visual identity / logo to align with, or freedom to define the nuclear theme from scratch?

Because the build is frontend-first, none of these block the start: Track A (design sketch through deployed frontend on the mock) can begin immediately.
Answers to 1-3 are needed only when Track B (the real inference backend) begins.
The most urgent input is #5 (branding), which feeds the design sketch in Phase 0.
