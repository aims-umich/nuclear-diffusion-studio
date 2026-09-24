import type { SizeId } from "@/lib/contract";

/**
 * Starting points on the Explore page. Picking one loads its prompt and size
 * into the composer.
 *
 * Placeholder set: Phase 5 (model validation) replaces these with prompts
 * known to produce strong results from the real model, and adds a
 * `thumbnail` rendered by it.
 */
export const EXAMPLE_CATEGORIES = ["Reactor systems", "Fuel cycle", "Facilities", "Physics"] as const;
export type ExampleCategory = (typeof EXAMPLE_CATEGORIES)[number];

export type Example = {
  title: string;
  category: ExampleCategory;
  prompt: string;
  sizeId: SizeId;
  thumbnail?: string;
};

export const EXAMPLES: readonly Example[] = [
  {
    title: "PWR core cutaway",
    category: "Reactor systems",
    prompt: "Cutaway of a pressurized-water reactor core, fuel assemblies and control rods, technical illustration",
    sizeId: "1:1",
  },
  {
    title: "Graphite moderator lattice",
    category: "Physics",
    prompt: "Neutron moderation in a graphite lattice, neutron paths traced in light",
    sizeId: "1:1",
  },
  {
    title: "Containment dome at dusk",
    category: "Facilities",
    prompt: "Nuclear power plant containment dome at dusk, long exposure photograph",
    sizeId: "1:1",
  },
  {
    title: "Spent fuel pool glow",
    category: "Fuel cycle",
    prompt: "Spent fuel pool from above, deep blue Cherenkov glow around the fuel racks",
    sizeId: "1:1",
  },
  {
    title: "Steam generator tube bundle",
    category: "Reactor systems",
    prompt: "Steam generator tube bundle, cutaway, technical illustration",
    sizeId: "1:1",
  },
  {
    title: "TRISO fuel particle",
    category: "Fuel cycle",
    prompt: "TRISO fuel particle cross-section showing its coating layers, macro photograph",
    sizeId: "1:1",
  },
  {
    title: "Cooling towers in fog",
    category: "Facilities",
    prompt: "Natural-draft cooling towers in morning fog, wide angle photograph",
    sizeId: "1:1",
  },
  {
    title: "Fission chain reaction",
    category: "Physics",
    prompt: "Diagram of a uranium-235 fission chain reaction, neutrons splitting nuclei",
    sizeId: "1:1",
  },
];
