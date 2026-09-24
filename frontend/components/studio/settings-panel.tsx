"use client";

import { useId, useState } from "react";
import { ChevronDown, Dices, RotateCcw, X } from "lucide-react";
import { RadioGroup, Switch } from "radix-ui";
import { Slider } from "@/components/ui/slider";
import { AspectGlyph } from "@/components/studio/composer";
import { IconButton, StatusDot, type ModelStatus } from "@/components/studio/sidebar";
import { LIMITS, MODEL, SIZE_PRESETS, sizePresetById, type SizeId } from "@/lib/contract";
import { exceedsPromptTokens } from "@/lib/prompt-tokens";
import { randomSeed } from "@/lib/prng";
import type { Settings } from "@/lib/studio-state";
import { cn } from "@/lib/utils";

type SettingsPanelProps = {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onReset: () => void;
  onClose: () => void;
  status: ModelStatus;
  mode: "mock" | "live";
  advancedOpen: boolean;
  onAdvancedOpenChange: (open: boolean) => void;
};

export function SettingsPanel({
  settings,
  onChange,
  onReset,
  onClose,
  status,
  mode,
  advancedOpen,
  onAdvancedOpenChange,
}: SettingsPanelProps) {
  const ids = { aspect: useId(), images: useId(), steps: useId(), guidance: useId(), seed: useId(), negative: useId(), advanced: useId() };
  const size = sizePresetById(settings.sizeId);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 flex-none items-center gap-1 border-b border-line pr-2.5 pl-5">
        <h2 className="flex-1 text-[14.5px] font-medium">Run settings</h2>
        <IconButton label="Reset to defaults" onClick={onReset}>
          <RotateCcw />
        </IconButton>
        <IconButton label="Close run settings" onClick={onClose}>
          <X />
        </IconButton>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 pt-[18px] pb-7">
        <div className="rounded-xl border border-line-strong bg-white/2 p-3.5">
          <div className="flex items-center justify-between font-medium">
            {MODEL.label}
            <span
              className={cn(
                "flex items-center gap-[7px] text-xs font-normal",
                status.tone === "active" ? "text-cherenkov-ink" : status.tone === "warn" ? "text-warn" : "text-fg-muted",
              )}
            >
              <StatusDot tone={status.tone} />
              {status.label}
            </span>
          </div>
          <div className="mt-0.5 font-mono text-xs text-fg-subtle">{MODEL.id}</div>
          <p className="mt-2 text-[12.5px] leading-normal text-fg-muted">
            SDXL fine-tuned for nuclear-engineering imagery, from the NuclearDiffusion paper.
          </p>
          {mode === "mock" && (
            <p className="mt-2 text-[12.5px] leading-normal text-fg-muted">
              Mock engine: images are placeholders until the GPU service is connected.
            </p>
          )}
        </div>

        <div>
          <FieldLabel id={ids.aspect} value={`${size.width}×${size.height}`}>
            Aspect ratio
          </FieldLabel>
          <RadioGroup.Root
            aria-labelledby={ids.aspect}
            value={settings.sizeId}
            onValueChange={(value) => onChange({ sizeId: value as SizeId })}
            className="grid grid-cols-3 gap-1.5"
          >
            {SIZE_PRESETS.map((preset) => (
              <RadioGroup.Item
                key={preset.id}
                value={preset.id}
                aria-label={`${preset.id}, ${preset.width} by ${preset.height}${preset.trained ? "" : ", experimental"}`}
                className={segmentClass("h-14 flex-col gap-[7px] font-mono text-[11.5px]")}
              >
                <AspectGlyph width={preset.width} height={preset.height} />
                {preset.id}
              </RadioGroup.Item>
            ))}
          </RadioGroup.Root>
          <Hint>
            {size.trained
              ? "The size nd-xl was fine-tuned on."
              : "Experimental. nd-xl was fine-tuned on square images, so results at this size may be weaker."}
          </Hint>
        </div>

        <div>
          <FieldLabel id={ids.images}>Images per run</FieldLabel>
          <RadioGroup.Root
            aria-labelledby={ids.images}
            value={String(settings.numImages)}
            onValueChange={(value) => onChange({ numImages: Number(value) })}
            className="grid grid-cols-4 gap-1.5"
          >
            {Array.from({ length: LIMITS.images.max }, (_, index) => index + 1).map((count) => (
              <RadioGroup.Item
                key={count}
                value={String(count)}
                aria-label={count === 1 ? "1 image" : `${count} images`}
                className={segmentClass("h-9 text-[13px]")}
              >
                {count}
              </RadioGroup.Item>
            ))}
          </RadioGroup.Root>
          <Hint>
            {settings.numImages === 1
              ? "Each image gets its own seed."
              : `Each image gets its own seed. ${settings.numImages} images take about ${settings.numImages}× as long.`}
          </Hint>
        </div>

        <RangeField
          id={ids.steps}
          label="Steps"
          value={settings.steps}
          display={String(settings.steps)}
          min={LIMITS.steps.min}
          max={LIMITS.steps.max}
          step={1}
          onChange={(steps) => onChange({ steps })}
          hint="More steps add detail and take longer. The model card uses 50."
        />

        <RangeField
          id={ids.guidance}
          label="Guidance"
          value={settings.guidance}
          display={settings.guidance.toFixed(1)}
          min={LIMITS.guidance.min}
          max={LIMITS.guidance.max}
          step={LIMITS.guidance.step}
          onChange={(guidance) => onChange({ guidance })}
          hint="Higher values follow the prompt more literally."
        />

        <div>
          <button
            type="button"
            aria-expanded={advancedOpen}
            aria-controls={ids.advanced}
            onClick={() => onAdvancedOpenChange(!advancedOpen)}
            className="flex h-10 w-full items-center justify-between border-t border-line text-[13.5px] font-medium"
          >
            Advanced
            <ChevronDown
              aria-hidden
              strokeWidth={1.5}
              className={cn("size-5 text-fg-muted transition-transform duration-200", advancedOpen && "rotate-180")}
            />
          </button>
          <div id={ids.advanced} hidden={!advancedOpen} className="flex flex-col gap-[22px] pt-1.5">
            <SeedField id={ids.seed} settings={settings} onChange={onChange} />
            <NegativePromptField id={ids.negative} settings={settings} onChange={onChange} />
            <div className="flex items-center justify-between text-[13px]">
              <span>Scheduler</span>
              <span>
                Euler <span className="font-mono text-xs text-fg-subtle">{MODEL.scheduler}</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function segmentClass(extra: string) {
  return cn(
    "flex items-center justify-center rounded-[9px] border border-line-strong text-fg-muted transition-colors hover:border-white/28 hover:text-fg",
    "data-[state=checked]:border-cherenkov/55 data-[state=checked]:bg-cherenkov/14 data-[state=checked]:text-cherenkov-ink",
    extra,
  );
}

function FieldLabel({ id, value, children }: { id: string; value?: string; children: React.ReactNode }) {
  return (
    <div className="mb-2.5 flex items-baseline justify-between gap-2.5">
      <span id={id} className="text-[13px]">
        {children}
      </span>
      {value && <span className="font-mono text-xs text-fg-muted">{value}</span>}
    </div>
  );
}

function Hint({ children, tone }: { children: React.ReactNode; tone?: "warn" }) {
  return <p className={cn("mt-2 text-xs leading-normal text-fg-subtle", tone === "warn" && "text-warn")}>{children}</p>;
}

function RangeField(props: {
  id: string;
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  hint: string;
}) {
  const { id, label, value, display, min, max, step, onChange, hint } = props;
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span id={id} className="text-[13px]">
          {label}
        </span>
        <span className="grid h-7 min-w-[52px] place-items-center rounded-[7px] border border-line-strong bg-field px-2 font-mono text-[12.5px] tabular-nums">
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
        className="px-[7px]"
      />
      <div className="mt-2.5 flex justify-between font-mono text-[11px] text-fg-subtle">
        <span>{min}</span>
        <span>{max}</span>
      </div>
      <Hint>{hint}</Hint>
    </div>
  );
}

function SeedField({ id, settings, onChange }: { id: string; settings: Settings; onChange: (patch: Partial<Settings>) => void }) {
  const random = settings.seed === null;
  // Keep the last typed seed around so toggling Random off and on does not lose it.
  const [lastSeed, setLastSeed] = useState<number | null>(settings.seed);
  const [inputId, switchId] = [`${id}-input`, `${id}-switch`];

  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between">
        {random ? (
          <span className="text-[13px]">Seed</span>
        ) : (
          <label htmlFor={inputId} className="text-[13px]">
            Seed
          </label>
        )}
        <label htmlFor={switchId} className="flex items-center gap-[9px] text-[12.5px] text-fg-muted">
          Random
          <Switch.Root
            id={switchId}
            checked={random}
            onCheckedChange={(checked) => {
              if (checked) {
                setLastSeed(settings.seed);
                onChange({ seed: null });
              } else {
                onChange({ seed: lastSeed ?? randomSeed() });
              }
            }}
            className="relative h-5 w-[34px] flex-none rounded-full bg-white/18 transition-colors data-[state=checked]:bg-cherenkov-fill"
          >
            <Switch.Thumb className="block size-3.5 translate-x-[3px] rounded-full bg-fg transition-transform data-[state=checked]:translate-x-[17px]" />
          </Switch.Root>
        </label>
      </div>
      {random ? (
        <div className="flex h-[38px] items-center rounded-[9px] border border-line-strong bg-field px-3 text-[13px] text-fg-subtle">
          New seed each run
        </div>
      ) : (
        <div className="flex gap-2">
          <input
            id={inputId}
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            value={settings.seed ?? ""}
            onChange={(event) => {
              const digits = event.target.value.replace(/\D/g, "");
              const value = digits === "" ? 0 : Number(digits);
              onChange({ seed: value > LIMITS.seedMax ? settings.seed : value });
            }}
            className="h-[38px] min-w-0 flex-1 rounded-[9px] border border-line-strong bg-field px-3 font-mono text-[13px] tabular-nums outline-none focus-visible:border-cherenkov/70"
          />
          <IconButton
            label="Roll a new seed"
            onClick={() => onChange({ seed: randomSeed() })}
            className="size-[38px] border border-line-strong"
          >
            <Dices />
          </IconButton>
        </div>
      )}
      <Hint>
        {settings.numImages > 1
          ? `Image n of a run uses this seed plus n − 1.`
          : "A fixed seed reproduces the same image from the same settings."}
      </Hint>
    </div>
  );
}

function NegativePromptField({
  id,
  settings,
  onChange,
}: {
  id: string;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}) {
  const text = settings.negativePrompt;
  const inactive = text.trim() !== "" && settings.guidance <= LIMITS.guidance.min;
  const truncated = exceedsPromptTokens(text);

  return (
    <div>
      <div className="mb-2.5 flex items-baseline justify-between">
        <label htmlFor={id} className="text-[13px]">
          Negative prompt
        </label>
        <span className="font-mono text-xs text-fg-muted tabular-nums">
          {text.length} / {LIMITS.negativePromptMaxLength}
        </span>
      </div>
      <textarea
        id={id}
        value={text}
        maxLength={LIMITS.negativePromptMaxLength}
        rows={3}
        placeholder="blurry, low quality"
        onChange={(event) => onChange({ negativePrompt: event.target.value })}
        className="block max-h-40 min-h-[76px] w-full resize-none rounded-[9px] border border-line-strong bg-field px-3 py-2.5 text-[13.5px] leading-normal text-fg-soft [field-sizing:content] outline-none placeholder:text-fg-subtle focus-visible:border-cherenkov/70"
      />
      {inactive ? (
        <Hint tone="warn">Has no effect at guidance 1.0. Raise guidance to use it.</Hint>
      ) : truncated ? (
        <Hint tone="warn">Past the model&apos;s {MODEL.maxPromptTokens}-token limit. The end is ignored.</Hint>
      ) : (
        <Hint>What the model should steer away from.</Hint>
      )}
    </div>
  );
}
