"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Composer } from "@/components/console/composer";
import { OutputPanel } from "@/components/console/output-panel";
import { SessionStrip } from "@/components/console/session-strip";
import { SiteHeader, type ConnectionStatus } from "@/components/console/site-header";
import { useGenerator } from "@/hooks/use-generator";
import { ERROR_CODES, LIMITS, type ImageSize } from "@/lib/contract";
import { selectedGeneration, type Draft, type Generation, type Status } from "@/lib/console-state";

const INITIAL_DRAFT: Draft = {
  prompt: "",
  steps: LIMITS.steps.default,
  guidance: LIMITS.guidance.default,
  size: LIMITS.defaultSize,
  seed: null,
};

export function InferenceConsole({ mode }: { mode: "mock" | "live" }) {
  const { state, run, cancel, select, reset } = useGenerator();
  const [draft, setDraft] = useState<Draft>(INITIAL_DRAFT);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const { status } = state;
  const generating = status.kind === "generating";
  const selected = selectedGeneration(state);

  const patchDraft = useCallback((patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch })), []);

  // When the layout is stacked (phones), the output sits below the composer; bring it into
  // view so starting a generation visibly does something.
  const start = useCallback(
    (next: Draft) => {
      const output = outputRef.current;
      if (output && output.getBoundingClientRect().top > window.innerHeight * 0.6) {
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        output.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      }
      void run(next);
    },
    [run],
  );

  const submit = useCallback(() => {
    if (generating || !draft.prompt.trim()) return;
    start({ ...draft, prompt: draft.prompt.trim() });
  }, [draft, generating, start]);

  // Cmd/Ctrl+Enter generates from anywhere; Escape cancels a running generation.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        if (!draft.prompt.trim()) promptRef.current?.focus();
        submit();
      } else if (event.key === "Escape" && generating) {
        cancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancel, draft.prompt, generating, submit]);

  const draftFrom = (generation: Generation, seed: number | null): Draft => ({
    prompt: generation.params.prompt,
    steps: generation.params.num_inference_steps,
    guidance: generation.params.guidance_scale,
    size: generation.params.width as ImageSize,
    seed,
  });

  const actions = {
    onDownload: (generation: Generation) => downloadImage(generation),
    onCopySeed: (generation: Generation) => {
      navigator.clipboard
        .writeText(String(generation.seed))
        .then(() => toast.success(`Seed ${generation.seed} copied`))
        .catch(() => toast.error("Couldn't copy the seed. Select it from the image badge instead."));
    },
    onVariation: (generation: Generation) => {
      setDraft(draftFrom(generation, generation.seed));
      promptRef.current?.focus();
      toast("Settings loaded with the same seed. Edit the prompt, then generate.");
    },
    onRegenerate: (generation: Generation) => {
      const next = draftFrom(generation, null);
      setDraft(next);
      start(next);
    },
  };

  const retry = () => {
    if (status.kind === "error") start(status.draft);
  };

  const startNew = () => {
    reset();
    patchDraft({ prompt: "" });
    promptRef.current?.focus();
  };

  const outputSize = selected?.params.width ?? (status.kind === "generating" || status.kind === "error" ? status.draft.size : draft.size);

  return (
    <>
      <SiteHeader status={connectionStatus(status)} mode={mode} />
      <main className="mx-auto max-w-[1320px] px-[clamp(16px,4vw,32px)] pt-[clamp(26px,4vw,48px)] pb-[100px]">
        <div className="flex flex-col gap-[clamp(26px,4.5vw,56px)] split:flex-row split:items-start">
          <Composer
            draft={draft}
            onDraftChange={patchDraft}
            onGenerate={submit}
            progress={status.kind === "generating" ? { step: status.step, totalSteps: status.totalSteps } : null}
            promptRef={promptRef}
          />
          <div ref={outputRef} className="flex min-w-0 scroll-mt-4 flex-col gap-[18px] split:flex-[2_1_500px]">
            <OutputPanel status={status} selected={selected} size={outputSize} onRetry={retry} onCancel={cancel} {...actions} />
            <SessionStrip
              generations={state.generations}
              selectedId={selected?.id ?? null}
              disabled={generating}
              onSelect={select}
              onNew={startNew}
            />
          </div>
        </div>
      </main>
      <p aria-live="polite" className="sr-only">
        {announcement(status, selected)}
      </p>
    </>
  );
}

function connectionStatus(status: Status): ConnectionStatus {
  switch (status.kind) {
    case "idle":
      return { label: "Idle", tone: "neutral" };
    case "generating":
      return { label: "Generating", tone: "active" };
    case "result":
      return { label: "Ready", tone: "active" };
    case "error":
      return { label: status.code === ERROR_CODES.coldStart ? "Offline" : "Error", tone: "warn" };
  }
}

function announcement(status: Status, selected: Generation | null): string {
  switch (status.kind) {
    case "idle":
      return "";
    case "generating":
      return "Generating image.";
    case "result":
      return selected ? `Image ready. Seed ${selected.seed}.` : "";
    case "error":
      return `Generation failed. ${status.message}`;
  }
}

function downloadImage(generation: Generation) {
  const mime = /^data:image\/([\w+.-]+)[;,]/.exec(generation.image)?.[1] ?? "png";
  const extension = mime === "svg+xml" ? "svg" : mime === "jpeg" ? "jpg" : mime;
  const link = document.createElement("a");
  link.href = generation.image;
  link.download = `nucleardiffusion-${generation.seed}.${extension}`;
  document.body.append(link);
  link.click();
  link.remove();
}
