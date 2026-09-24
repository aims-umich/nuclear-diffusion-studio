"use client";

import { useId, type RefObject } from "react";
import { ArrowUp, Layers, Square } from "lucide-react";
import { LIMITS, MODEL, sizePresetById } from "@/lib/contract";
import { estimatePromptTokens } from "@/lib/prompt-tokens";
import type { Settings } from "@/lib/studio-state";
import { cn } from "@/lib/utils";

/** Start showing the token estimate once a prompt gets close to the limit. */
const TOKEN_HINT_FROM = 60;

type ComposerProps = {
  prompt: string;
  onPromptChange: (prompt: string) => void;
  settings: Settings;
  generating: boolean;
  onSubmit: () => void;
  onStop: () => void;
  onOpenSettings: () => void;
  promptRef: RefObject<HTMLTextAreaElement | null>;
};

export function Composer({
  prompt,
  onPromptChange,
  settings,
  generating,
  onSubmit,
  onStop,
  onOpenSettings,
  promptRef,
}: ComposerProps) {
  const tokenHintId = useId();
  const tokens = estimatePromptTokens(prompt);
  const overLimit = tokens > MODEL.maxPromptTokens;
  const showTokens = tokens >= TOKEN_HINT_FROM;
  const empty = prompt.trim().length === 0;
  const size = sizePresetById(settings.sizeId);

  return (
    <form
      aria-label="Compose"
      onSubmit={(event) => {
        event.preventDefault();
        if (generating) onStop();
        else onSubmit();
      }}
      className="mx-auto max-w-[800px] rounded-[20px] border border-line-strong bg-field py-3.5 pr-3.5 pb-2.5 pl-[18px] shadow-[0_-20px_40px_-10px_#000] transition-colors focus-within:border-white/30"
    >
      <label htmlFor="prompt" className="sr-only">
        Prompt
      </label>
      <textarea
        id="prompt"
        ref={promptRef}
        value={prompt}
        maxLength={LIMITS.promptMaxLength}
        rows={1}
        enterKeyHint="send"
        placeholder="Describe an image"
        aria-describedby={showTokens ? tokenHintId : undefined}
        onChange={(event) => onPromptChange(event.target.value)}
        onKeyDown={(event) => {
          // Enter sends, Shift+Enter adds a line. Cmd/Ctrl+Enter is handled globally.
          if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          if (!generating) onSubmit();
        }}
        className="block max-h-52 min-h-[26px] w-full resize-none bg-transparent text-[15px] leading-[1.55] text-fg [field-sizing:content] outline-none placeholder:text-fg-subtle focus-visible:outline-none"
      />
      {overLimit && (
        <p className="mt-2 text-[12.5px] text-warn">
          The model reads about the first {MODEL.maxPromptTokens} tokens. Words past that point are ignored.
        </p>
      )}
      <div className="mt-2.5 flex items-center gap-1.5">
        <Chip onClick={onOpenSettings} label={`Aspect ratio ${size.id}. Change in run settings`}>
          <AspectGlyph width={size.width} height={size.height} />
          {size.id}
        </Chip>
        <Chip onClick={onOpenSettings} label={`${settings.numImages === 1 ? "1 image" : `${settings.numImages} images`} per run. Change in run settings`}>
          <Layers aria-hidden strokeWidth={1.5} className="size-4" />
          {settings.numImages === 1 ? "1 image" : `${settings.numImages} images`}
        </Chip>
        <span
          id={tokenHintId}
          className={cn("min-w-0 flex-1 text-right font-mono text-[11.5px] text-fg-subtle tabular-nums", overLimit && "text-warn")}
        >
          {showTokens && `~${tokens} / ${MODEL.maxPromptTokens} tokens`}
        </span>
        {generating ? (
          <button
            type="submit"
            aria-label="Stop generating"
            title="Stop (Esc)"
            className="grid size-[38px] flex-none place-items-center rounded-full bg-fg text-on-fg transition-opacity hover:opacity-85"
          >
            <Square aria-hidden fill="currentColor" strokeWidth={0} className="size-3.5" />
          </button>
        ) : (
          <button
            type="submit"
            aria-label="Generate"
            title="Generate (Enter)"
            disabled={empty}
            className="grid size-[38px] flex-none place-items-center rounded-full bg-cherenkov-fill text-white transition-colors hover:bg-cherenkov-hover disabled:cursor-default disabled:bg-white/10 disabled:text-fg-subtle"
          >
            <ArrowUp aria-hidden strokeWidth={2} className="size-5" />
          </button>
        )}
      </div>
    </form>
  );
}

function Chip({ onClick, label, children }: { onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-8 items-center gap-[7px] rounded-full border border-line-strong px-[11px] text-[12.5px] text-fg-soft transition-colors hover:border-white/30 hover:text-fg"
    >
      {children}
    </button>
  );
}

/** A small outline rectangle in the preset's proportions. */
export function AspectGlyph({ width, height, className }: { width: number; height: number; className?: string }) {
  // A square reads heavier than an oblong of the same long side, so it is drawn smaller.
  const long = width === height ? 14 : 17;
  const w = width >= height ? long : Math.round((long * width) / height);
  const h = height >= width ? long : Math.round((long * height) / width);
  return (
    <span
      aria-hidden
      style={{ width: w, height: h }}
      className={cn("block flex-none rounded-[2px] border-[1.5px] border-current", className)}
    />
  );
}
