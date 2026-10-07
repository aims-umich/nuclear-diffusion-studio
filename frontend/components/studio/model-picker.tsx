"use client";

import { useState } from "react";
import { ArrowUpRight, Check, Copy, Database, FileText, ImageIcon, Info, Rocket, TriangleAlert, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { toast } from "sonner";
import { IconButton } from "@/components/studio/sidebar";
import { CURRENT_MODEL, formatReleaseDate, MODELS, type ModelInfo } from "@/lib/models";
import { cn } from "@/lib/utils";

/**
 * The model list, as a panel over the right edge, opened by `children` (one button).
 * It is a modal dialog: focus stays inside, and Escape closes it and returns focus to the button.
 */
export function ModelPicker({ children }: { children: React.ReactElement }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>{children}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-50 flex w-[min(460px,100vw)] flex-col border-l border-line bg-panel shadow-[0_0_60px_-10px_#000] outline-none data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:animate-in data-[state=open]:slide-in-from-right"
        >
          <div className="flex h-14 flex-none items-center gap-1 border-b border-line pr-2.5 pl-5">
            <Dialog.Title className="flex-1 text-[14.5px] font-medium">Models</Dialog.Title>
            <IconButton label="Close models" onClick={() => setOpen(false)}>
              <X />
            </IconButton>
          </div>
          <ul className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            {MODELS.map((model) => (
              <ModelCard
                key={model.id}
                model={model}
                selected={model.id === CURRENT_MODEL.id}
                onSelect={() => setOpen(false)}
              />
            ))}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ModelCard({ model, selected, onSelect }: { model: ModelInfo; selected: boolean; onSelect: () => void }) {
  const copyId = () => {
    navigator.clipboard
      .writeText(model.id)
      .then(() => toast.success("Model ID copied"))
      .catch(() => toast.error("Couldn't copy the model ID. Select it from the card instead."));
  };

  return (
    <li
      className={cn(
        "relative rounded-xl border p-4 transition-colors",
        selected ? "border-cherenkov/55 bg-cherenkov/6" : "border-line-strong bg-white/2 hover:border-white/28",
      )}
    >
      <div className="flex items-start gap-3">
        <ModelGlyph />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-[14.5px] font-medium">
              {/* Stretched over the whole card, so a click anywhere picks the model. */}
              <button
                type="button"
                onClick={onSelect}
                aria-current={selected || undefined}
                className="text-left outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-cherenkov"
              >
                {model.name}
              </button>
            </h3>
            {selected && (
              <span className="flex items-center gap-1 text-xs text-cherenkov-ink">
                <Check aria-hidden strokeWidth={2} className="size-3.5" />
                In use
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate font-mono text-xs text-fg-subtle">{model.id}</div>
        </div>
        <div className="relative z-10 -mt-1.5 -mr-1.5 flex">
          <IconButton label="Copy model ID" onClick={copyId} className="size-8 [&_svg]:size-4">
            <Copy />
          </IconButton>
          <a
            href={model.cardUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Open the model card (opens in a new tab)"
            title="Open the model card"
            className="grid size-8 place-items-center rounded-[9px] text-fg-muted transition-colors hover:bg-white/6 hover:text-fg"
          >
            <ArrowUpRight aria-hidden strokeWidth={1.5} className="size-4" />
          </a>
        </div>
      </div>

      <dl className="mt-3.5 flex flex-col gap-2 text-[12.5px] leading-normal text-pretty text-fg-muted">
        <Fact icon={Info} label="About">
          {model.description}
        </Fact>
        <Fact icon={ImageIcon} label="Input and output">
          {model.task}
        </Fact>
        <Fact icon={Database} label="Training data">
          {model.trainingData}
        </Fact>
        <Fact icon={TriangleAlert} label="Limitations">
          {model.limitations}
        </Fact>
        <Fact icon={Rocket} label="Release">
          Released {formatReleaseDate(model.released)} • {model.license} license
        </Fact>
        <Fact icon={FileText} label="Paper">
          <a
            href={model.paperUrl}
            target="_blank"
            rel="noreferrer"
            className="relative z-10 inline-flex items-center gap-1 text-cherenkov-ink hover:underline"
          >
            NuclearDiffusion paper
            <ArrowUpRight aria-hidden strokeWidth={1.5} className="size-3.5" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </Fact>
      </dl>
    </li>
  );
}

function Fact({ icon: Icon, label, children }: { icon: typeof Info; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <dt className="flex-none pt-[3px]">
        <Icon aria-hidden strokeWidth={1.5} className="size-3.5" />
        <span className="sr-only">{label}</span>
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

/** The studio's mark, the same ring as the favicon. */
function ModelGlyph() {
  return (
    <span
      aria-hidden
      className="grid size-9 flex-none place-items-center rounded-[9px] border border-line-strong bg-white/4"
    >
      <svg viewBox="0 0 32 32" className="size-5 text-fg">
        <circle cx="16" cy="16" r="9" fill="none" stroke="currentColor" strokeWidth="2.4" />
        <circle cx="16" cy="16" r="2.6" fill="currentColor" />
      </svg>
    </span>
  );
}
