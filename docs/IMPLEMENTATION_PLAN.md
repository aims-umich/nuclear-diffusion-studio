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

> **Status (2026-10-07):** Track B phases 5-7 are done locally.
> The inference service (`backend/`) is deployed on Modal at `https://jeremoon--nuclear-diffusion-studio-inference-web.modal.run`, and `npm run dev` with `frontend/.env.local` runs the studio against the real model end to end.
> Still open: Phase 4 (GitHub remote and Vercel), after which `INFERENCE_API_URL` and `INFERENCE_API_TOKEN` go into Vercel as Sensitive env vars.

> **GPU host (decided 2026-09-23): Modal.** Serverless, scale-to-zero, billed per second, and the Starter plan's $30/month of free compute should cover lab-demo traffic.
> Section 5 records the decision and the alternatives considered; Sections 6, 8, 9, 10, and 11 carry the Modal-specific design.

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
This has four consequences that shape everything below:

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
       num_inference_steps=50,         # the model card and paper's setting
       guidance_scale=5.0,             # the SDXL pipeline default the model card uses
   ).images[0]
   ```

2. **It needs a GPU.** SDXL at fp16 wants roughly 10-16 GB of VRAM for comfortable inference.
   This is the single biggest architectural decision: where the GPU lives (see Section 5).

3. **The model is on the Hugging Face Hub under Apache 2.0**, downloaded on demand.
   The base SDXL weights (~7 GB) plus the custom UNet download on first load, so container images and cold starts must account for that.

4. **SDXL sets the limits the app can honestly offer** (verified 2026-09-24 against the model card, its UNet `config.json`, and the paper).
   The fine-tune was trained only on 1024x1024 images, so that is the default and other sizes are limited to SDXL-native ~1 MP presets marked experimental; 512 and 768 are dropped because SDXL degrades below ~1 MP.
   The CLIP text encoders read 75 usable tokens and silently drop the rest, so the service reports truncation.
   The base pipeline's scheduler is Euler (`euler`), and guidance 1.0 disables classifier-free guidance, which makes a negative prompt a no-op.
   `docs/API.md` ("What the model supports") is the reference.

A quick reproducibility step is worth doing before writing any app code: run the snippet above on a GPU (`modal run`, or the AIMS cluster's 1-GPU, 5-hour free tier), confirm the model loads and produces a sane nuclear-domain image, and record a few known-good prompts and parameter values.
Those become the app's defaults and the seed content for a prompt-gallery.

---

## 3. High-level architecture

Three logical pieces, cleanly separated so each can be deployed and scaled independently:

```
                                                          (GPU, on Modal)
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
- Uvicorn for local runs; on Modal, the same FastAPI app is served through `@modal.asgi_app()` and the container image is defined in Python (`modal.Image`), so there is no Dockerfile to maintain
- `modal` SDK for deployment (Section 5)

**Why not do inference in Next.js / Node?**
The model ecosystem is Python-only (`diffusers`), and the lab's ML code is already Python.
A separate Python service is simpler and more robust than trying to bridge into Node.
Next.js still earns its place: its `/api/generate` route handler is the server-side seam that hosts the mock during frontend-first development and later proxies to the Python service, keeping any HF/storage tokens off the client.

---

## 5. Where the GPU lives (the key decision)

The frontend is trivial to host. The real choice is how to serve GPU inference.

**Decision (2026-09-23): Modal.**

A research demo gets bursty, low traffic and sits idle most of the day, so the deciding factor is idle cost, not raw GPU price.
Modal bills per second of container time and scales to zero, so an idle day costs nothing.
One 50-step SDXL image (the model card's setting) is about 12s of A10 time (about $0.004); a realistic visit, including a cold start and the idle window before scale-down, is about $0.05-0.10.
The Starter plan includes **$30/month of free compute**, roughly 300-600 visits a month, which should cover lab-demo traffic at $0.

Why Modal fits this codebase specifically:

- The FastAPI service from Section 6 runs on Modal unchanged (`@modal.asgi_app()`), streaming NDJSON included, so the frozen contract needs no adapter.
- The frontend already has a cold-start state, and Section 6 covers how scale-from-zero surfaces on Modal.
- Deploys, secrets, image builds, and logs are all Python and CLI, with no infrastructure to run.
- `modal serve` gives a hot-reloading dev URL on a real GPU, so nobody needs a local GPU to work on the backend.

**Alternatives considered**

| Option | Why not (for now) |
| --- | --- |
| **AWS** (EC2 / SageMaker) | Always-on is the only practical GPU shape: about $590/month (g6.xlarge, L4) to $735/month (g5.xlarge, A10G) on-demand. The AWS Cloud Credit for Research program fits ("science-as-a-service"), but undergrads cannot apply, review takes 90-120 days, and credits expire after a year. |
| **Hugging Face Inference Endpoints** | Also always-on in practice (scale-to-zero cold starts take minutes), and needs a custom `handler.py` because the repo is UNet-only. |
| **Hugging Face ZeroGPU Space** | Free to host, but Gradio-only (breaks the frozen contract) and quota is charged to the caller, so all site traffic through one server token shares one account's daily quota. Still worth publishing as a companion demo on the model page (Phase 8). |
| **Replicate** | Similar economics to Modal, but needs Cog packaging and its own prediction API rather than our FastAPI contract. |
| **Jetstream2 via NSF ACCESS** | Free always-on GPU VMs (a `g3.large`, half an A100, is plenty) with no wall-clock limit, but it needs an approved allocation with a faculty or grad-student PI. The standby option if traffic outgrows Modal's economics (Section 11). |
| **AIMS cluster** | 48-hour process cap and a 1-GPU, 5-hour free tier rule out a public service, and campus machines should not face the internet. Good for Phase 5 model validation. |

**Portability principle (kept):** the inference code is a plain FastAPI + diffusers package in `backend/`, and `deploy/modal_app.py` is only a thin wrapper around it.
If hosting ever changes (for example to Jetstream2), the same package runs under plain `uvicorn` and only the wrapper is replaced.

---

## 6. Inference service design

**Model loading (once, at startup / container warm)**

- Load base SDXL + custom UNet in fp16 on CUDA.
- Apply memory/speed optimizations: torch SDPA attention (the diffusers default), optional `enable_model_cpu_offload()` if VRAM is tight.
  Skip `torch.compile`: with scale-to-zero, compile time lands on every cold start and costs more than it saves.
- Load once into a module-level singleton so requests reuse the warm pipeline; never load per request.
- Pin the Hugging Face revision (commit SHA) of both `kumo24/sdxl_nuclear` and the SDXL base, so a seed reproduces the same image across deploys.

**Running on Modal**

`deploy/modal_app.py` wraps the `backend/` package in one Modal class:

```python
@app.cls(
    gpu=["L4", "A10", "L40S"],        # cheapest per visit first; fall back instead of waiting for capacity
    image=image,                      # weights baked in at build time, pinned revisions
    secrets=[modal.Secret.from_name("nuclear-diffusion-studio")],  # INFERENCE_API_TOKEN
    enable_memory_snapshot=True,
    scaledown_window=60,              # seconds idle before scale-to-zero; covers a user iterating on prompts
    min_containers=0,                 # always 0: serverless only, never a warm GPU
    max_containers=2,                 # cost ceiling; excess requests queue at Modal
    timeout=300,
)
class Inference:
    @modal.enter(snap=True)
    def load(self):                   # imports + weights into CPU RAM, captured in the memory snapshot
        self.engine = SDXLEngine.load(Path(WEIGHTS), device="cpu")

    @modal.enter(snap=False)
    def to_gpu(self):                 # runs on every container start, after the snapshot restore
        self.engine.to("cuda")

    @modal.asgi_app(requires_proxy_auth=True)
    def web(self):
        return create_app(self.engine, token=..., limiter=...)  # the same FastAPI app `uvicorn` serves
```

> **As built (2026-10-07):** `deploy/benchmark.py` measured one 1024x1024 image at 50 steps in 21.1s on an L4, 15.8s on an A10, and 6.1s on an L40S (batch of four: 88s, 60s, 23s).
> The L40S is cheapest per image, but a visit's cost is dominated by the idle scale-down tail billed at the GPU rate, so the L4 is cheapest per visit unless one visit makes more than about 19 images (Section 11).
> L4 capacity is sometimes scarce: one cold start waited over two minutes for an L4, so the class lists A10 and L40S as fallbacks.
> The fine-tuned UNet is published as a 10 GB fp32 checkpoint; the image build stores it once in fp16, which is what every load casts it to anyway.

- **Weights in the image.** Downloading at image build time (`backend/app/weights.py`, run as an image build step) makes cold starts independent of Hugging Face availability and bandwidth, and ties each deploy to one exact model revision.
- **Memory snapshots.** CPU snapshots are stable and restore imports plus CPU-resident weights; only the host-to-GPU copy runs on each cold start.
  GPU snapshots (`experimental_options={"enable_gpu_snapshot": True}`) would skip that copy too, but they are alpha; revisit once they stabilize.
- **One request per container.** The class takes no `@modal.concurrent`, so each container serves one generation at a time and Modal queues and scales the rest up to `max_containers`.
  The in-process GPU lock stays anyway, so plain `uvicorn` runs behave the same.
- **Auth.** A Modal web endpoint URL is public, so it uses Modal proxy auth (`requires_proxy_auth=True`): Modal checks the token at its edge, so a request without it is rejected before any GPU container starts.
  `INFERENCE_API_TOKEN` is that proxy token as `<id>.<secret>`, which the proxy already sends as `Authorization: Bearer`; the FastAPI app checks the same token again, so it stays protected under plain uvicorn.
  The browser never calls the backend directly, so CORS is not needed.
- **Timeouts.** Modal answers `303` if a request has not started responding within 150s; the proxy gives up waiting for a response at 115s, so that limit is never reached.
  Once the stream has started, it runs to its terminal event (up to the route's 300s limit).

**How a cold start surfaces on Modal**

A scale-from-zero request does not get a `503`: Modal holds it until a container is up, then our code runs and streams `accepted` as usual.
From the browser's side, a cold start is a longer wait before `accepted`: about 30s measured with snapshots (most of it restoring the snapshot and creating one for a new worker type), longer when Modal has to wait for GPU capacity.
After 4s without `accepted`, the UI says the GPU is waking and that the first run can take up to a minute (`?mock=waking` reproduces it).
The first request after each deploy also builds the memory snapshot; send one yourself after deploying so a visitor does not pay for it.
The contract does not change: `503 ERR_COLD_START` stays valid for other hosts, and the UI treats a slow `accepted` as a UI-only concern (Phase 7).

**API contract (frozen)**

`POST /generate` - the full wire-level spec lives in `docs/API.md` in the repo, and the machine-readable source of truth is `frontend/lib/contract.ts`.

```jsonc
// request
{
  "prompt": "string (required, 1-500 chars; only 75 CLIP tokens reach the model)",
  "negative_prompt": "string (optional)",
  "num_inference_steps": 50,      // 10-50, default 50
  "guidance_scale": 5.0,          // 1-15, default 5.0
  "width": 1024,                  // with height, one of the six SDXL presets in docs/API.md
  "height": 1024,
  "num_images": 1,                // 1-4, one batch; image i uses seed + i
  "seed": 12345                   // optional uint32; omit for random
}
```

A successful response is an `application/x-ndjson` stream: `accepted` first, one `progress` per denoising step, then exactly one `result` or `error`.

```jsonc
{"type":"accepted","seed":12345,"total_steps":50,"num_images":2,"model":"kumo24/sdxl_nuclear"}
{"type":"progress","step":1,"total_steps":50}
{"type":"result","images":[{"image":"data:image/png;base64,...","seed":12345},{"image":"...","seed":12346}],"params":{...,"scheduler":"euler","prompt_truncated":false},"timing_ms":23400,"model":"kumo24/sdxl_nuclear"}
```

Non-2xx responses carry `{"error":{"code","message","retry_after_s?"}}`; a warming model returns `503` + `Retry-After` (`ERR_COLD_START`).

> **As built:** the contract streams progress from day one instead of returning one JSON body, because the base design centres on a live step counter and percentage.
> A backend that cannot stream yet may still return the original single-JSON shape; the Next.js proxy converts it into `accepted` + `result`, so the UI keeps working (just without step progress).

**Concurrency and latency**

- A single GPU runs one pipeline call at a time; SDXL at 50 steps is ~5-12s per image on an A10G/A100 once warm, and a batch of n images takes roughly n times as long.
- Serialize GPU access with a lock or a small in-process queue so concurrent requests don't collide on the device.
- Set generous client and server timeouts (60-120s) to survive cold starts and queueing.
- Consider a job model (`POST /generate` returns a `job_id`, client polls `GET /jobs/{id}`) if you expect bursts; for a v1 demo, a synchronous request with a loading state is simpler and fine.

**Progress feedback (part of the contract)**

- `diffusers` supports a per-step callback (`callback_on_step_end`); emit one `progress` NDJSON line per step.
- NDJSON over a plain streamed POST is used rather than SSE or WebSockets: it needs no extra protocol and passes through the Next.js proxy unchanged.

**Safety / abuse**

- Rate-limit by IP (the GPU is the scarce resource).
  The backend only sees Vercel's IP, so the proxy forwards the client IP in `X-Forwarded-For` and the backend keys its limiter on that, stored in a `modal.Dict` so the limit holds across containers.
  Forwarding the header is a contract change: update `lib/contract.ts`, `docs/API.md`, the mock, and the proxy together.
- Hard cost ceiling: the **Modal workspace budget** ($30, equal to the Starter credit) stops billable work once the monthly limit is hit, a **spend limit** of $0 blocks any out-of-pocket charge, and `max_containers` bounds the burn rate below both.
- Cap prompt length and reject empty prompts.
- Optionally run a lightweight NSFW/safety check on outputs before returning; note it's a research/domain model, so scope this to your risk tolerance.

---

## 7. Frontend design - a standard image studio

**Decided 2026-09-24:** the console became a three-pane image-generation studio in the style of Google AI Studio, ChatGPT Images, and Gemini.
The authoritative design is `Studio v2.dc.html` in the Claude Design project "AI Inference Frontend Console" (https://claude.ai/design/p/dd0f1479-3a31-464f-a7be-1e2e305d3fda?file=Studio+v2.dc.html).
The original `Inference Console.dc.html` stays in that project as the superseded base.

**Layout**

- **Left sidebar:** New thread, Explore examples, and the thread history (named after each thread's first prompt, grouped Today / Previous 7 days / Older, with delete and undo).
  The footer shows the model, a status light, a Mock badge in mock mode, and links to the paper and model card.
  It collapses to an icon rail, and becomes a drawer below 860px.
- **Center:** a chat-like feed of generation turns (prompt, settings, 1-4 images, Regenerate and Edit prompt) above a pinned composer.
  Enter sends and Shift+Enter adds a line.
  A new thread shows the Explore page: example prompts filtered by category.
- **Right, "Run settings":** model card, aspect ratio, images per run, steps, guidance, and a collapsed Advanced group (seed, negative prompt, read-only scheduler).
  Inline from 1200px, a sheet below.
- **Lightbox:** full-size view with arrow keys through a batch.

**Art direction**

- **Palette:** true black with neutral gray layers and one accent, Cherenkov blue (#4c8dff; #2f6feb for filled buttons), used only for the primary action, selected controls, and generation progress.
  Amber (#f6b23c) is reserved for alerts.
- **Typography:** IBM Plex Sans for the interface and IBM Plex Mono only for real data (seeds, sizes, step counts).
- **Signature moment:** while denoising, each image tile fills with Cherenkov-blue light from the bottom as steps advance; it replaces a progress bar.

**Honest model limits in the UI**

- Non-square sizes carry an "experimental" note because the fine-tune saw only squares.
- The composer estimates CLIP tokens and warns past 75; the result says when the backend truncated a prompt.
- The negative prompt field warns that it has no effect at guidance 1.0.

**Accessibility & responsiveness**

- Full keyboard support (Cmd/Ctrl+Enter, Esc to cancel, arrow keys in radio groups and the lightbox), visible focus rings, labels on every control, and Radix dialogs for the drawer, sheet, and lightbox.
- `prefers-reduced-motion` drops the glow transition and the reveal.
- Works at phone width with no horizontal scroll; image actions stay visible on touch screens.

**Persistence**

- Threads are saved in the browser's IndexedDB (real PNGs are megabytes, beyond localStorage's quota), capped at 100.
- Run settings and panel layout are saved in localStorage.
- `?thread=<id>` reopens a thread after a reload.
- A shareable, cross-device gallery still needs the object storage in Section 3 (Phase 8).

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
      page.tsx         # the studio
      layout.tsx
      api/
        generate/
          route.ts     # mock in frontend-first phase, then proxy to backend
    components/
      ui/              # shadcn/ui components (copied in)
      studio/          # sidebar, feed, composer, run settings, explore, lightbox
    hooks/             # useStudio (reducer + network + persistence), useMediaQuery
    lib/
      contract.ts      # the frozen /api/generate contract (zod)
      api.ts           # typed streaming client for /api/generate
      studio-state.ts  # pure reducer: threads, turns, the running generation
      storage.ts       # IndexedDB thread store + localStorage preferences
      mock/            # placeholder images + fake seed/timing/state generator
    app/globals.css    # Tailwind v4 theme tokens (no tailwind.config in v4)
    tests/unit/        # Vitest: contract, mock engine, reducer, client, route (both modes)
    tests/e2e/         # Playwright: desktop Chromium, desktop WebKit, mobile
    package.json
    .env.local         # INFERENCE_API_URL (unset => route handler serves the mock)
  backend/             # FastAPI + diffusers inference service  <- added later (Track B)
    app/
      main.py          # create_app(pipeline): FastAPI app, routes, bearer auth
      pipeline.py      # model loading + generate(), pinned model revisions
      schemas.py       # pydantic request/response models (match frontend contract)
    tests/             # pytest against a fake pipeline, CPU-only (contract, auth, stream shape)
    requirements.txt   # inference runtime, installed into the Modal image (torch, diffusers, FastAPI)
    requirements-dev.txt  # local tooling only (Modal CLI, pytest); no torch on laptops
  deploy/
    modal_app.py       # Modal image + Inference class wrapping backend/ (Section 6)
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

> **Superseded 2026-09-24** by the studio redesign (Section 7): the notes below describe the first console.

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

**Phase 5 - Modal setup & model validation (half a day)** - done 2026-10-07 (the Modal for Academics application is still open)

- Create the Modal workspace on the Starter plan, set a **workspace budget** of $30/month and a **spend limit** of $0 so the free credit is the ceiling (done 2026-10-07), and create the `nuclear-diffusion-studio` secret with a generated `INFERENCE_API_TOKEN`.
- Ask the PI to apply to **Modal for Academics** (up to $10k in credits; faculty, postdocs, and PhD students are eligible), so traffic growth never blocks on budget.
- `modal run` the load+generate snippet (Section 2) and confirm image quality; capture 6-10 strong example prompts and good default params (these seed the example chips).
- Benchmark L4, A10, and L40S: seconds per image at 1024 and 50 steps (and a batch of 4), cold-start time with snapshots, and cost per image. Keep the cheapest GPU whose warm single-image latency stays under about 15s.
- Record the pinned model revisions.

**Phase 6 - Inference service (1-2 days)** - done 2026-10-07

- `backend/` FastAPI app with `POST /generate`, pydantic validation matching the frozen contract, warm singleton pipeline, GPU lock, bearer-token auth.
- Stream NDJSON from `callback_on_step_end`; return a base64 PNG, the seed actually used, and timing.
- Per-IP rate limiting on the forwarded client IP, with the matching contract change (Section 6, Safety).
- pytest suite against a fake pipeline, so contract and auth tests run on CPU in CI.
- `deploy/modal_app.py` per Section 6; iterate with `modal serve`, then point a local `npm run dev` at the dev URL for a real end-to-end run.

**Phase 7 - Deploy backend & flip the switch (1 day)** - done 2026-10-07 locally; the Vercel env vars wait on Phase 4

- `modal deploy deploy/modal_app.py` for a stable HTTPS endpoint.
- Set `INFERENCE_API_URL` and `INFERENCE_API_TOKEN` in Vercel to flip `/api/generate` from **mock to proxy** - no client-side changes.
- Cold-start UX: time a real scale-from-zero request. If the wait before `accepted` reads as a hang, show a "warming up" hint in the generating state after a few seconds with no `accepted` (UI-only, contract unchanged), and cover it with a mock scenario and an E2E test.
- Final QA: real end-to-end runs on desktop and mobile, warm and cold latency, rate-limit and budget-stop behavior.

**Phase 3b - Studio redesign (2026-09-24)** - done

- Rebuilt the console as the three-pane studio in Section 7 from the approved `Studio v2.dc.html`.
- Aligned the contract with what the model supports: SDXL-native sizes, batches of 1-4, truncation flags, the `euler` scheduler, and model-card defaults (50 steps, guidance 5.0).
- Threads persist in the browser (IndexedDB).

**Phase 8 (optional, v2) - persistence & extras**

- Object storage for a persistent, shareable, cross-device gallery with permalinks (local thread history already exists).
- A companion Hugging Face ZeroGPU Space linked from the model page, for visibility in the HF ecosystem.
- img2img, prompt presets, light auth.

---

## 10. Deployment & ops summary

- **Frontend:** Next.js on Vercel (same as `aims-website`). Ships first with the mock route handler active, so there is a live link before any backend exists.
- **The flip:** setting `INFERENCE_API_URL` switches the `/api/generate` route handler from mock to proxy - the one config change that turns the demo real. Unset, it serves the mock.
- **Backend:** a Modal app (`modal deploy deploy/modal_app.py`), scale-to-zero with `max_containers` as the burn-rate cap. `min_containers` stays 0, even for live demos: the GPU never runs unless a request is being served or the scale-down window is open.
- **Secrets:** none in the client. `INFERENCE_API_TOKEN` lives in Vercel (sent by the proxy) and in the Modal secret (checked by the backend); rotate both together.
- **Access:** the backend accepts only bearer-authenticated server-to-server calls from the proxy, so no CORS configuration is needed.
- **Monitoring:** Modal's dashboard for per-container logs, GPU seconds, and spend; log generation timings and failures in the backend; watch cold-start frequency against the scale-down window.

---

## 11. Cost notes

Modal list prices (October 2026): L4 $0.000222/s, A10 $0.000306/s, L40S $0.000542/s, plus about $0.0000222/s for the ~10 GiB of container memory.
Times below are measured (`deploy/benchmark.py`, 2026-10-07).

| Item | Approximate cost |
| --- | --- |
| One warm image (1024, 50 steps): L4 21s / A10 16s / L40S 6s | $0.0047 / $0.0048 / $0.0033 |
| One visit (~30s cold start + 3 images + 60s scale-down tail) on L4 | about $0.035 |
| The same visit when it falls back to an A10 / L40S | about $0.04 / $0.06 |
| Idle day | $0 |
| Starter plan free compute | $30/month, roughly 700-900 such visits |
| One container kept warm 24/7 (L4) | about $630/month - never done (decided 2026-10-07) |

- **Levers, in order of impact:** the scale-down window (idle tail billed at the GPU rate), cold-start time (snapshots), then GPU choice.
- **If traffic outgrows the free tier:** Modal for Academics credits first; if usage becomes steady enough that always-on is cheaper, move the same `backend/` package to a free **Jetstream2** GPU VM through an NSF ACCESS Explore allocation (1-page proposal, faculty or grad-student PI) and point `INFERENCE_API_URL` at it.

---

## 12. Open questions for Jeremy

1. ~~**GPU hosting**~~ - decided 2026-09-23: Modal (Section 5).
2. **Audience & traffic:** internal lab tool, or a public link that could see real traffic? This sets how hard we harden rate limiting and cold-start handling.
3. **Persistence:** partly decided 2026-09-24: thread history is saved per browser (IndexedDB). Still open: do we want a shareable, cross-device gallery (needs object storage)?
4. **Repo:** create `nuclear-diffusion-studio` as a new fourth `aims/` project with its own `jere67` remote, following the group's conventions?
5. **Branding:** any existing AIMS visual identity / logo to align with, or freedom to define the nuclear theme from scratch?

Because the build is frontend-first, none of these block the start: Track A (design sketch through deployed frontend on the mock) can begin immediately.
Answers to 2-3 are needed only when Track B (the real inference backend) begins.
The most urgent input is #5 (branding), which feeds the design sketch in Phase 0.
