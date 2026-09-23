"use client";

import Image from "next/image";
import { Plus } from "lucide-react";
import type { Generation } from "@/lib/console-state";
import { cn } from "@/lib/utils";

type SessionStripProps = {
  generations: Generation[];
  selectedId: string | null;
  disabled: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
};

export function SessionStrip({ generations, selectedId, disabled, onSelect, onNew }: SessionStripProps) {
  if (generations.length === 0) return null;
  const count = generations.length;

  return (
    <section aria-label="Session history">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[13px] font-medium">Session</h2>
        <span className="font-mono text-[11px] font-medium text-fg-subtle tabular-nums">
          {count} {count === 1 ? "generation" : "generations"}
        </span>
      </div>
      <ul className="flex gap-2.5 overflow-x-auto p-0.5 pb-1">
        {generations.map((generation, index) => {
          const selected = generation.id === selectedId;
          return (
            <li key={generation.id} className="flex-none">
              <button
                type="button"
                disabled={disabled}
                aria-current={selected || undefined}
                aria-label={`Generation ${count - index}: ${generation.params.prompt}`}
                onClick={() => onSelect(generation.id)}
                className={cn(
                  "relative block size-[82px] overflow-hidden rounded-[10px] border bg-hatch-fine transition-[border-color,opacity] disabled:cursor-default disabled:opacity-50",
                  selected ? "border-white/55" : "border-white/9 hover:border-white/30",
                )}
              >
                <Image
                  src={generation.image}
                  alt=""
                  width={82}
                  height={82}
                  unoptimized
                  className="size-full object-cover"
                />
                {selected && <span aria-hidden className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-fg" />}
              </button>
            </li>
          );
        })}
        <li className="flex-none">
          <button
            type="button"
            disabled={disabled}
            aria-label="Start a new generation"
            onClick={onNew}
            className="grid size-[82px] place-items-center rounded-[10px] border border-dashed border-white/16 bg-transparent text-fg-faint transition-colors hover:border-white/40 hover:text-fg disabled:cursor-default disabled:opacity-50"
          >
            <Plus aria-hidden strokeWidth={1.5} className="size-5" />
          </button>
        </li>
      </ul>
    </section>
  );
}
