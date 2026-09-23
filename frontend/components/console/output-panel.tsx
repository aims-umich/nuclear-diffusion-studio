"use client";

import Image from "next/image";
import { ERROR_CODES, MODEL } from "@/lib/contract";
import { progressPercent, type Generation, type Status } from "@/lib/console-state";
import { cn } from "@/lib/utils";

export type ResultActions = {
  onDownload: (generation: Generation) => void;
  onCopySeed: (generation: Generation) => void;
  onVariation: (generation: Generation) => void;
  onRegenerate: (generation: Generation) => void;
};

type OutputPanelProps = {
  status: Status;
  selected: Generation | null;
  size: number;
  onRetry: () => void;
  onCancel: () => void;
} & ResultActions;

export function OutputPanel({ status, selected, size, onRetry, onCancel, ...actions }: OutputPanelProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/9 bg-panel">
      <div className="flex items-center justify-between border-b border-white/7 px-4 py-3 font-mono text-[10.5px] font-medium text-fg-subtle">
        <h2 className="tracking-[0.16em]">OUTPUT</h2>
        <span>
          {MODEL.label} · {size}²
        </span>
      </div>

      {status.kind === "idle" && <IdleView />}
      {status.kind === "generating" && (
        <GeneratingView step={status.step} totalSteps={status.totalSteps} seed={status.seed} onCancel={onCancel} />
      )}
      {status.kind === "result" && selected && <ResultView generation={selected} {...actions} />}
      {status.kind === "error" && (
        <ErrorView code={status.code} message={status.message} httpStatus={status.status} retryAfter={status.retryAfterSeconds} onRetry={onRetry} />
      )}
    </div>
  );
}

function IdleView() {
  return (
    <div className="flex min-h-[496px] items-center justify-center px-5">
      <div className="text-center">
        <div aria-hidden className="relative mx-auto size-32">
          <span className="absolute inset-0 rounded-full border border-white/14" />
          <span className="absolute inset-7 rounded-full border border-white/8" />
          <span className="absolute top-1/2 left-1/2 size-[9px] -translate-1/2 rounded-full bg-fg-muted" />
          <span className="absolute -top-[3px] left-1/2 size-[5px] -translate-x-1/2 rounded-full bg-fg-subtle" />
        </div>
        <p className="mt-6 font-mono text-[11px] font-medium tracking-[0.26em] text-fg-muted">AWAITING PROMPT</p>
        <p className="mt-2 text-[13.5px] text-fg-faint">
          Compose a concept <span className="split:hidden">above</span>
          <span className="hidden split:inline">on the left</span> to begin.
        </p>
      </div>
    </div>
  );
}

function GeneratingView({
  step,
  totalSteps,
  seed,
  onCancel,
}: {
  step: number;
  totalSteps: number;
  seed: number | null;
  onCancel: () => void;
}) {
  const percent = progressPercent(step, totalSteps);
  const phase = seed === null ? "CONNECTING" : step === 0 ? "STARTING" : "DENOISING";
  return (
    <div className="relative flex min-h-[496px] flex-col items-center justify-center overflow-hidden">
      <div
        aria-hidden
        className="absolute top-1/2 left-1/2 size-[420px] -translate-1/2 animate-breathe-slow rounded-full bg-[radial-gradient(circle,rgb(255_255_255/0.05),transparent_66%)]"
      />
      <div className="relative flex w-[260px] max-w-[78%] flex-col items-center">
        <div className="font-mono text-[42px] font-semibold tracking-[-0.02em] tabular-nums" data-testid="progress-percent">
          {percent}
          <span className="text-lg tracking-normal text-fg-subtle">%</span>
        </div>
        <div className="mt-[18px] animate-breathe font-mono text-[11px] font-medium tracking-[0.26em] text-fg-muted">{phase}</div>
        <div
          role="progressbar"
          aria-label="Generation progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="relative mt-5 h-[3px] w-full overflow-hidden rounded-sm bg-white/12"
        >
          <div className="absolute inset-y-0 left-0 rounded-sm bg-meter transition-[width] duration-200 ease-out" style={{ width: `${percent}%` }} />
          <div
            aria-hidden
            className="absolute inset-y-0 left-0 w-2/5 animate-shimmer bg-[linear-gradient(90deg,transparent,rgb(255_255_255/0.55),transparent)]"
          />
        </div>
        <div className="mt-4 font-mono text-[11px] font-medium text-fg-subtle tabular-nums">
          step {step} / {totalSteps}
          {seed !== null && ` · seed ${seed}`}
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="mt-5 min-h-9 rounded-md px-3 font-mono text-[11px] font-medium text-fg-muted transition-colors hover:text-fg"
        >
          Cancel <span className="text-fg-subtle pointer-coarse:hidden">esc</span>
        </button>
      </div>
    </div>
  );
}

function ResultView({ generation, onDownload, onCopySeed, onVariation, onRegenerate }: { generation: Generation } & ResultActions) {
  const { params } = generation;
  const meta = [
    ["steps", String(params.num_inference_steps)],
    ["guidance", params.guidance_scale.toFixed(1)],
    ["sampler", params.scheduler],
    ["size", params.width === params.height ? `${params.width}²` : `${params.width}×${params.height}`],
    ["time", `${(generation.timingMs / 1000).toFixed(2)}s`],
  ] as const;

  return (
    <div className="flex flex-col">
      <div className="relative flex min-h-96 items-center justify-center bg-hatch p-[clamp(14px,3vw,28px)]">
        <div key={generation.id} className="relative max-w-full animate-reveal">
          <Image
            src={generation.image}
            alt={`Generated image: ${params.prompt}`}
            width={params.width}
            height={params.height}
            unoptimized
            priority
            data-testid="result-image"
            className="aspect-square h-auto max-h-[min(58vh,600px)] w-auto max-w-full rounded-md object-contain ring-1 ring-white/8"
          />
          <span className="absolute top-2.5 right-2.5 rounded-md border border-white/14 bg-black/65 px-[9px] py-1 font-mono text-[10px] font-medium text-fg-muted tabular-nums backdrop-blur-sm">
            SEED {generation.seed}
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-3.5 border-t border-white/8 bg-panel-foot p-4">
        <p className="text-[13.5px] leading-[1.55] text-fg-soft">“{params.prompt}”</p>
        <dl className="flex flex-wrap gap-x-5 gap-y-[9px] font-mono text-xs font-medium">
          {meta.map(([key, value]) => (
            <div key={key} className="flex gap-[0.6ch]">
              <dt className="text-fg-subtle">{key}</dt>
              <dd className="tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap gap-2">
          <ActionButton onClick={() => onDownload(generation)}>Download</ActionButton>
          <ActionButton onClick={() => onCopySeed(generation)}>Copy seed</ActionButton>
          <ActionButton onClick={() => onVariation(generation)}>Use as variation</ActionButton>
          <ActionButton primary onClick={() => onRegenerate(generation)}>
            Regenerate
          </ActionButton>
        </div>
      </div>
    </div>
  );
}

function ActionButton({ primary, onClick, children }: { primary?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-[9px] border bg-transparent px-3.5 py-[9px] text-[12.5px] font-medium transition-colors",
        primary ? "border-white/32 text-fg hover:bg-white/6" : "border-white/12 text-fg-soft hover:border-white/30",
      )}
    >
      {children}
    </button>
  );
}

const ERROR_TITLES: Record<string, string> = {
  [ERROR_CODES.coldStart]: "Reactor offline",
  [ERROR_CODES.rateLimited]: "Slow down a little",
  [ERROR_CODES.timeout]: "Generation timed out",
  [ERROR_CODES.network]: "Connection lost",
  [ERROR_CODES.interrupted]: "Connection dropped",
  [ERROR_CODES.upstream]: "Inference service error",
  [ERROR_CODES.invalidRequest]: "Settings rejected",
};

function ErrorView({
  code,
  message,
  httpStatus,
  retryAfter,
  onRetry,
}: {
  code: string;
  message: string;
  httpStatus: number | null;
  retryAfter: number | null;
  onRetry: () => void;
}) {
  const wait = retryAfter ? ` ~${retryAfter}s` : "";
  const hint = code === ERROR_CODES.coldStart ? `endpoint warming${wait}` : wait ? `retry in${wait}` : null;
  const detail = [code, httpStatus, hint].filter(Boolean).join(" · ");
  return (
    <div role="alert" className="flex min-h-[496px] items-center justify-center">
      <div className="max-w-[372px] px-5 text-center">
        <div aria-hidden className="mx-auto flex size-[46px] rotate-45 items-center justify-center border border-warn/50 bg-warn/7">
          <span className="-rotate-45 text-xl font-semibold text-warn">!</span>
        </div>
        <h3 className="mt-6 text-[19px] font-semibold tracking-[-0.01em]">{ERROR_TITLES[code] ?? "Generation failed"}</h3>
        <p className="mt-2.5 text-sm leading-[1.6] text-balance text-fg-muted">
          {message} Your prompt and seed are saved.
        </p>
        <div className="mt-[22px] flex justify-center gap-[9px]">
          <button
            type="button"
            onClick={onRetry}
            className="rounded-[9px] border border-white/32 bg-transparent px-[18px] py-2.5 text-[13px] font-medium transition-colors hover:bg-white/6"
          >
            Retry generation
          </button>
        </div>
        <p className="mt-[18px] font-mono text-[10.5px] font-medium tracking-[0.04em] text-fg-faint">{detail}</p>
      </div>
    </div>
  );
}
