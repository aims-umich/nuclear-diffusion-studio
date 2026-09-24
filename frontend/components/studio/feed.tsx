"use client";

import Image from "next/image";
import { Copy, Download, Info, Maximize2, Pencil, RefreshCw, TriangleAlert, WandSparkles, X } from "lucide-react";
import { ERROR_CODES, sizePresetById, type GeneratedImage } from "@/lib/contract";
import { progressPercent, type Thread, type Turn } from "@/lib/studio-state";
import { cn } from "@/lib/utils";

export type TurnActions = {
  onDownload: (image: GeneratedImage) => void;
  onCopySeed: (image: GeneratedImage) => void;
  onVary: (turn: Turn, image: GeneratedImage) => void;
  onOpen: (turn: Turn, index: number) => void;
  onRegenerate: (turn: Turn) => void;
  onEditPrompt: (turn: Turn) => void;
  onRetry: (turn: Turn) => void;
  onCancel: () => void;
};

type FeedProps = TurnActions & {
  thread: Thread;
  /** A generation is running somewhere, so turn actions that start one are disabled. */
  busy: boolean;
};

export function Feed({ thread, busy, ...actions }: FeedProps) {
  return (
    <div className="mx-auto flex max-w-[800px] flex-col gap-11 px-4 pt-8 pb-6 nav:px-7">
      <h1 className="sr-only">{thread.title}</h1>
      {thread.turns.map((turn) => (
        <TurnView key={turn.id} turn={turn} busy={busy} {...actions} />
      ))}
    </div>
  );
}

function TurnView({ turn, busy, ...actions }: TurnActions & { turn: Turn; busy: boolean }) {
  const { request, params } = turn;
  const size = sizePresetById(request.sizeId);
  const negative = (params?.negative_prompt ?? request.negativePrompt).trim();

  return (
    <article aria-label={`Generation: ${request.prompt}`} className="flex flex-col gap-3.5">
      <p className="max-w-[64ch] text-[15.5px] leading-[1.55] text-pretty text-fg">{request.prompt}</p>
      <ul aria-label="Settings" className="flex flex-wrap gap-x-4 gap-y-1.5 font-mono text-xs text-fg-subtle">
        <li>{size.id}</li>
        <li>
          {size.width}×{size.height}
        </li>
        <li>{request.steps} steps</li>
        <li>guidance {request.guidance.toFixed(1)}</li>
        {params && <li>{params.scheduler}</li>}
        {turn.timingMs !== null && <li>{(turn.timingMs / 1000).toFixed(1)} s</li>}
      </ul>
      {negative && (
        <p className="-mt-1 text-[13px] text-fg-muted">
          <span className="text-fg-subtle">Avoiding:</span> {negative}
        </p>
      )}
      {params?.prompt_truncated && (
        <p className="flex items-center gap-2 text-[13px] text-fg-muted">
          <Info aria-hidden strokeWidth={1.5} className="size-4 flex-none text-warn" />
          Only the first 75 tokens of this prompt reached the model.
        </p>
      )}

      {turn.status === "error" && turn.failure && <ErrorCard turn={turn} busy={busy} onRetry={() => actions.onRetry(turn)} />}

      {turn.status === "generating" && (
        <>
          <div
            role="progressbar"
            aria-label="Generation progress"
            aria-valuemin={0}
            aria-valuemax={turn.totalSteps}
            aria-valuenow={turn.step}
            aria-valuetext={turn.step === 0 ? "Starting" : `Step ${turn.step} of ${turn.totalSteps}`}
            className={gridClass(request.numImages, size.width, size.height)}
          >
            {Array.from({ length: request.numImages }, (_, index) => (
              <DenoisingTile key={index} turn={turn} aspect={`${size.width} / ${size.height}`} />
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <TurnButton onClick={actions.onCancel}>
              <X aria-hidden />
              Cancel
              <kbd className="font-mono text-[11px] text-fg-subtle">Esc</kbd>
            </TurnButton>
          </div>
        </>
      )}

      {turn.status === "done" && params && (
        <>
          <div className={gridClass(turn.images.length, params.width, params.height)}>
            {turn.images.map((image, index) => (
              <ImageTile
                key={image.seed}
                image={image}
                prompt={request.prompt}
                width={params.width}
                height={params.height}
                onOpen={() => actions.onOpen(turn, index)}
                onDownload={() => actions.onDownload(image)}
                onCopySeed={() => actions.onCopySeed(image)}
                onVary={() => actions.onVary(turn, image)}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <TurnButton onClick={() => actions.onRegenerate(turn)} disabled={busy}>
              <RefreshCw aria-hidden />
              Regenerate
            </TurnButton>
            <TurnButton onClick={() => actions.onEditPrompt(turn)}>
              <Pencil aria-hidden />
              Edit prompt
            </TurnButton>
          </div>
        </>
      )}
    </article>
  );
}

/** One image fills a comfortable width for its shape; batches share the column. */
function gridClass(count: number, width: number, height: number) {
  const landscape = width > height;
  const portrait = height > width;
  return cn(
    "grid gap-2.5",
    count === 1 && ["grid-cols-1", landscape ? "max-w-[540px]" : portrait ? "max-w-[340px]" : "max-w-[420px]"],
    count === 2 && "grid-cols-2",
    count === 3 && "grid-cols-3",
    count === 4 && (portrait ? "grid-cols-4" : "max-w-[640px] grid-cols-2"),
  );
}

function ImageTile(props: {
  image: GeneratedImage;
  prompt: string;
  width: number;
  height: number;
  onOpen: () => void;
  onDownload: () => void;
  onCopySeed: () => void;
  onVary: () => void;
}) {
  const { image, prompt, width, height, onOpen, onDownload, onCopySeed, onVary } = props;
  return (
    <figure className="group/tile relative m-0 overflow-hidden rounded-xl border border-line bg-hatch">
      <button type="button" onClick={onOpen} aria-label={`Open full size, seed ${image.seed}`} className="block w-full">
        <Image
          src={image.image}
          alt={`Generated image: ${prompt}`}
          width={width}
          height={height}
          unoptimized
          data-testid="result-image"
          className="block h-auto w-full animate-reveal"
        />
      </button>
      <figcaption className="pointer-events-none absolute bottom-2.5 left-2.5 rounded-md border border-white/10 bg-black/65 px-2 py-[3px] font-mono text-[11px] text-fg-soft tabular-nums backdrop-blur-sm">
        seed {image.seed}
      </figcaption>
      <div className="absolute right-2 bottom-2 flex gap-1 opacity-0 transition-opacity group-focus-within/tile:opacity-100 group-hover/tile:opacity-100 [@media(hover:none)]:opacity-100">
        <TileButton label="Download" onClick={onDownload}>
          <Download />
        </TileButton>
        <TileButton label="Copy seed" onClick={onCopySeed}>
          <Copy />
        </TileButton>
        <TileButton label="Vary with this seed" onClick={onVary}>
          <WandSparkles />
        </TileButton>
        <TileButton label="Open full size" onClick={onOpen}>
          <Maximize2 />
        </TileButton>
      </div>
    </figure>
  );
}

/**
 * The in-progress image: Cherenkov-blue light rises through the frame as the
 * denoising steps advance, standing in for a progress bar.
 */
function DenoisingTile({ turn, aspect }: { turn: Turn; aspect: string }) {
  const percent = progressPercent(turn.step, turn.totalSteps);
  return (
    <div
      aria-hidden
      style={{ aspectRatio: aspect }}
      className="relative grid place-items-center overflow-hidden rounded-xl border border-cherenkov/28 bg-[#030305]"
    >
      <div className="absolute inset-0 bg-[repeating-linear-gradient(135deg,rgb(255_255_255/0.035)_0_10px,transparent_10px_20px)]" />
      <div
        className="absolute inset-x-[-20%] bottom-[-40%] h-[80%] bg-[radial-gradient(closest-side,rgb(76_141_255/0.22),transparent)]"
        style={{ opacity: 0.25 + 0.75 * (percent / 100) }}
      />
      <div
        className="absolute inset-x-0 bottom-0 border-t border-[rgb(150_190_255/0.95)] bg-linear-to-t from-cherenkov/34 to-cherenkov/7 shadow-[0_-10px_40px_-6px_rgb(76_141_255/0.55)] transition-[height] duration-200 ease-linear"
        style={{ height: `${percent}%` }}
      />
      <div className="relative text-center">
        <div className="font-mono text-[22px] font-medium tracking-[-0.01em] text-fg tabular-nums">
          {turn.step}
          <span className="text-sm text-fg-muted"> / {turn.totalSteps}</span>
        </div>
        <div className="mt-0.5 text-[12.5px] text-fg-soft">{turn.step === 0 ? "Starting" : "Denoising"}</div>
      </div>
    </div>
  );
}

const FAILURE_TITLES: Record<string, string> = {
  [ERROR_CODES.coldStart]: "The model is starting up",
  [ERROR_CODES.rateLimited]: "Too many generations at once",
  [ERROR_CODES.network]: "Can't reach the server",
  [ERROR_CODES.timeout]: "The model took too long",
};

function ErrorCard({ turn, busy, onRetry }: { turn: Turn; busy: boolean; onRetry: () => void }) {
  const failure = turn.failure!;
  const coldStart = failure.code === ERROR_CODES.coldStart;
  return (
    <div role="alert" className="flex gap-3.5 rounded-xl border border-warn/32 bg-warn/4.5 p-[18px]">
      <TriangleAlert aria-hidden strokeWidth={1.5} className="size-[22px] flex-none text-warn" />
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold">{FAILURE_TITLES[failure.code] ?? "Generation failed"}</h3>
        <p className="mt-1.5 mb-3.5 max-w-[58ch] text-[13.5px] text-fg-muted">
          {coldStart
            ? "The GPU was idle and is loading nd-xl. This usually takes about a minute."
            : failure.message}{" "}
          Your prompt and settings are kept, so you can retry as is.
        </p>
        <div className="flex flex-wrap items-center gap-3.5">
          <TurnButton onClick={onRetry} disabled={busy}>
            <RefreshCw aria-hidden />
            Retry
          </TurnButton>
          <span className="font-mono text-[11.5px] text-fg-subtle">
            {failure.code}
            {failure.status ? ` (${failure.status})` : ""}
          </span>
        </div>
      </div>
    </div>
  );
}

function TurnButton({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-8 items-center gap-[7px] rounded-lg border border-line-strong px-3 text-[13px] text-fg-soft transition-colors hover:border-white/30 hover:text-fg disabled:cursor-default disabled:opacity-45 disabled:hover:border-line-strong disabled:hover:text-fg-soft [&_svg]:size-4 [&_svg]:stroke-[1.5]"
    >
      {children}
    </button>
  );
}

function TileButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid size-8 place-items-center rounded-lg border border-white/12 bg-black/65 text-fg backdrop-blur-sm transition-colors hover:bg-[rgb(30_30_33/0.9)] [&_svg]:size-[17px] [&_svg]:stroke-[1.5]"
    >
      {children}
    </button>
  );
}
