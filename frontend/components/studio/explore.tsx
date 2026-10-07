"use client";

import { useState } from "react";
import Image from "next/image";
import { EXAMPLE_CATEGORIES, EXAMPLES, type Example } from "@/lib/examples";
import { PAPER_URL } from "@/lib/models";
import { cn } from "@/lib/utils";

const FILTERS = ["All", ...EXAMPLE_CATEGORIES] as const;
type Filter = (typeof FILTERS)[number];

export function Explore({ onPick }: { onPick: (example: Example) => void }) {
  const [filter, setFilter] = useState<Filter>("All");
  const examples = EXAMPLES.filter((example) => filter === "All" || example.category === filter);

  return (
    <section aria-labelledby="explore-heading" className="mx-auto max-w-[1040px] px-4 pt-8 pb-8 nav:px-8 nav:pt-14">
      <h1 id="explore-heading" className="text-2xl leading-tight font-medium tracking-[-0.02em] text-balance nav:text-[30px]">
        Visualize nuclear energy concepts
      </h1>
      <p className="mt-2.5 max-w-[70ch] text-[15px] text-pretty text-fg-muted">
        {/* Non-breaking hyphens keep "general-purpose" and "fine-tuned" whole. */}
        General{"\u2011"}purpose image models often get reactors, fuel and radiation wrong. The models here are
        fine{"\u2011"}tuned on 1,000 captioned nuclear energy images from the{" "}
        <a
          href={PAPER_URL}
          target="_blank"
          rel="noreferrer"
          className="text-fg-soft underline decoration-white/30 underline-offset-[3px] transition-colors hover:text-fg hover:decoration-fg"
        >
          NuclearDiffusion study
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
        . Pick an example to load its prompt, or describe your own below.
      </p>

      <div role="group" aria-label="Filter examples" className="mt-7 mb-[18px] flex flex-wrap gap-1.5">
        {FILTERS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={filter === option}
            onClick={() => setFilter(option)}
            className={cn(
              "h-8 rounded-full border border-line-strong px-3.5 text-[13px] text-fg-muted transition-colors hover:border-white/28 hover:text-fg",
              filter === option && "border-fg bg-fg text-on-fg hover:border-fg hover:text-on-fg",
            )}
          >
            {option}
          </button>
        ))}
      </div>

      {/* Three columns divide the six examples evenly; a row of five would leave one on its own. */}
      <ul className="grid grid-cols-2 gap-3 nav:max-w-[720px] nav:grid-cols-3">
        {examples.map((example) => (
          <li key={example.title}>
            <button
              type="button"
              onClick={() => onPick(example)}
              className="group relative block aspect-square w-full overflow-hidden rounded-[14px] border border-line bg-hatch text-left transition-colors hover:border-white/30"
            >
              <Image src={example.thumbnail} alt="" fill unoptimized className="object-cover" sizes="(min-width: 860px) 240px, 50vw" />
              <span className="absolute inset-x-0 bottom-0 flex flex-col bg-linear-to-t from-black/90 to-transparent px-3.5 pt-11 pb-3.5">
                <span className="text-sm leading-snug font-medium text-fg">{example.title}</span>
                <span className="mt-0.5 text-xs text-fg-muted">{example.category}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
