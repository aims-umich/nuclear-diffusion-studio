"use client";

import { useId, useState, useSyncExternalStore, type RefObject } from "react";
import { ArrowRight } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { LIMITS } from "@/lib/contract";
import type { Draft, ImageSize } from "@/lib/console-state";
import { EXAMPLE_PROMPTS } from "@/lib/examples";
import { randomSeed } from "@/lib/prng";
import { cn } from "@/lib/utils";

type ComposerProps = {
  draft: Draft;
  onDraftChange: (patch: Partial<Draft>) => void;
  onGenerate: () => void;
  /** Present while a generation runs. */
  progress: { step: number; totalSteps: number } | null;
  promptRef: RefObject<HTMLTextAreaElement | null>;
};

export function Composer({ draft, onDraftChange, onGenerate, progress, promptRef }: ComposerProps) {
  const ids = {
    prompt: useId(),
    counter: useId(),
    promptError: useId(),
    steps: useId(),
    guidance: useId(),
    seed: useId(),
    size: useId(),
  };
  const [showEmptyError, setShowEmptyError] = useState(false);
  const generating = progress !== null;
  const promptLength = draft.prompt.length;

  const submit = () => {
    if (!draft.prompt.trim()) {
      setShowEmptyError(true);
      promptRef.current?.focus();
      return;
    }
    onGenerate();
  };

  return (
    <section aria-label="Compose" className="flex min-w-0 flex-col gap-[26px] split:max-w-[432px] split:flex-[1_1_360px]">
      <div>
        <div className="mb-3 flex items-baseline justify-between">
          <label htmlFor={ids.prompt} className="text-[13px] font-medium">
            Prompt
          </label>
          <span id={ids.counter} className="font-mono text-[11px] font-medium text-fg-subtle">
            <span className="sr-only">Characters used: </span>
            {promptLength} / {LIMITS.promptMaxLength}
          </span>
        </div>
        <textarea
          id={ids.prompt}
          ref={promptRef}
          value={draft.prompt}
          maxLength={LIMITS.promptMaxLength}
          placeholder="Describe a nuclear energy concept to visualize"
          aria-describedby={showEmptyError ? `${ids.counter} ${ids.promptError}` : ids.counter}
          aria-invalid={showEmptyError || undefined}
          rows={4}
          onChange={(event) => {
            onDraftChange({ prompt: event.target.value });
            if (showEmptyError) setShowEmptyError(false);
          }}
          className={cn(
            "block max-h-72 min-h-[124px] w-full resize-none rounded-xl border border-white/10 bg-field px-4 py-[15px] text-[15px] leading-[1.55] text-fg [field-sizing:content] placeholder:text-fg-subtle",
            "transition-colors outline-none focus-visible:border-white/35 focus-visible:outline-none",
            showEmptyError && "border-warn/60 focus-visible:border-warn/70",
          )}
        />
        {showEmptyError && (
          <p id={ids.promptError} className="mt-2 text-[12.5px] text-warn">
            Describe what to generate first.
          </p>
        )}
      </div>

      <div>
        <div className="mb-[13px] font-mono text-[10.5px] font-medium tracking-[0.16em] text-fg-subtle">TRY</div>
        <ul className="flex flex-col gap-[3px]">
          {EXAMPLE_PROMPTS.map((example) => (
            <li key={example}>
              <button
                type="button"
                onClick={() => {
                  onDraftChange({ prompt: example });
                  setShowEmptyError(false);
                  promptRef.current?.focus();
                }}
                className="group flex min-h-8 items-center gap-[9px] rounded-md py-1 text-left text-[13.5px] text-fg-muted transition-colors hover:text-fg"
              >
                <ArrowRight
                  aria-hidden
                  strokeWidth={1.5}
                  className="size-3.5 flex-none text-fg-ghost transition-[color,translate] duration-200 group-hover:translate-x-0.5 group-hover:text-fg-muted"
                />
                {example}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div aria-hidden className="h-px bg-white/8" />

      <div>
        <ParameterSlider
          id={ids.steps}
          label="Steps"
          value={draft.steps}
          display={String(draft.steps)}
          min={LIMITS.steps.min}
          max={LIMITS.steps.max}
          step={1}
          onChange={(steps) => onDraftChange({ steps })}
        />
        <div className="h-[22px]" />
        <ParameterSlider
          id={ids.guidance}
          label="Guidance"
          value={draft.guidance}
          display={draft.guidance.toFixed(1)}
          min={LIMITS.guidance.min}
          max={LIMITS.guidance.max}
          step={LIMITS.guidance.step}
          onChange={(guidance) => onDraftChange({ guidance })}
        />

        <div className="mt-[26px] flex flex-wrap gap-[26px]">
          <div className="min-w-0 flex-[1_1_150px]">
            <label htmlFor={ids.seed} className="mb-[11px] block text-[13px]">
              Seed
            </label>
            <div className="flex gap-2">
              <input
                id={ids.seed}
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                placeholder="Random"
                value={draft.seed ?? ""}
                onChange={(event) => onDraftChange({ seed: parseSeed(event.target.value, draft.seed) })}
                className="h-[38px] min-w-0 flex-1 rounded-[9px] border border-white/10 bg-field px-3 font-mono text-[13px] font-medium text-fg tabular-nums outline-none placeholder:text-fg-subtle focus-visible:border-white/35 focus-visible:outline-none"
              />
              <button
                type="button"
                title="Randomize seed"
                aria-label="Randomize seed"
                onClick={() => onDraftChange({ seed: randomSeed() })}
                className="grid size-[38px] flex-none grid-cols-3 grid-rows-3 place-items-center rounded-[9px] border border-white/10 bg-field p-[9px] transition-colors hover:border-white/32"
              >
                {Array.from({ length: 9 }, (_, index) => (
                  <span key={index} className={cn(index % 2 === 0 && "size-[3px] rounded-full bg-fg-muted")} />
                ))}
              </button>
            </div>
          </div>

          <div className="min-w-0 flex-[1_1_150px]">
            <div id={ids.size} className="mb-[11px] text-[13px]">
              Size
            </div>
            <ToggleGroup
              type="single"
              spacing={1.5}
              aria-labelledby={ids.size}
              value={String(draft.size)}
              onValueChange={(value) => {
                // Radix allows deselecting a single toggle group; a size is always required.
                if (value) onDraftChange({ size: Number(value) as ImageSize });
              }}
              className="w-full"
            >
              {([1024] as const).map((size) => (
                <ToggleGroupItem
                  key={size}
                  value={String(size)}
                  aria-label={`${size} by ${size} pixels`}
                  className="h-[38px] flex-1 rounded-lg border border-white/10 bg-transparent font-mono text-xs font-medium text-fg-muted hover:border-white/24 hover:bg-transparent hover:text-fg-muted data-[state=on]:border-white/42 data-[state=on]:bg-white/7 data-[state=on]:text-fg"
                >
                  {size}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </div>
      </div>

      {generating ? (
        <button
          type="button"
          disabled
          className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-white/16 bg-white/4 p-[15px] text-[15px] font-semibold text-fg-muted"
        >
          Generating
          <span className="font-mono text-[11px] font-medium text-fg-subtle tabular-nums">
            step {progress.step} / {progress.totalSteps}
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={submit}
          className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-fg p-[15px] text-[15px] font-semibold text-on-fg transition-shadow hover:shadow-[0_0_26px_-6px_rgb(255_255_255/0.4)]"
        >
          Generate
          <ShortcutHint />
        </button>
      )}
    </section>
  );
}

function ParameterSlider(props: {
  id: string;
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const { id, label, value, display, min, max, step, onChange } = props;
  return (
    <div>
      <div className="mb-[13px] flex items-baseline justify-between">
        <span id={id} className="text-[13px]">
          {label}
        </span>
        <span aria-hidden className="font-mono text-xs font-medium tabular-nums">
          {display}
        </span>
      </div>
      <Slider
        aria-labelledby={id}
        aria-valuetext={display}
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([next]) => onChange(next)}
      />
    </div>
  );
}

function parseSeed(raw: string, previous: number | null): number | null {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  const value = Number(digits);
  return value > LIMITS.seedMax ? previous : value;
}

const subscribeToNothing = () => () => {};

function isApplePlatform() {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /mac|iphone|ipad/i.test(nav.userAgentData?.platform ?? nav.platform ?? "");
}

function ShortcutHint() {
  // Server render assumes Apple; the client corrects it without a hydration mismatch.
  const apple = useSyncExternalStore(subscribeToNothing, isApplePlatform, () => true);
  return (
    <span aria-hidden className="font-mono text-[11px] font-medium text-on-fg/60 pointer-coarse:hidden">
      {apple ? "⌘ ↵" : "Ctrl ↵"}
    </span>
  );
}
