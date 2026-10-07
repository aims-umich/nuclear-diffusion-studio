import type { SizeId } from "@/lib/contract";

/**
 * Starting points on the Explore page. Picking one loads its prompt and size
 * into the composer.
 *
 * Each prompt was checked against the real model (Phase 5, 2026-10-07), and its
 * thumbnail is that render at 1024x1024, 50 steps, guidance 5.0, with `seed`.
 * The fine-tune draws equipment, buildings and materials well; abstract
 * diagrams (a fission chain, neutron paths) and hyperbolic cooling towers came
 * out weak, so they are not offered.
 */
export const EXAMPLE_CATEGORIES = ["Reactor systems", "Fuel cycle", "Facilities", "Physics"] as const;
export type ExampleCategory = (typeof EXAMPLE_CATEGORIES)[number];

export type Example = {
  title: string;
  category: ExampleCategory;
  prompt: string;
  sizeId: SizeId;
  /** A render of this prompt by the real model. */
  thumbnail: string;
  /** The seed that rendered `thumbnail`. */
  seed: number;
};

export const EXAMPLES: readonly Example[] = [
  {
    title: "PWR core cutaway",
    category: "Reactor systems",
    prompt: "Cutaway of a pressurized-water reactor core, fuel assemblies and control rods, technical illustration",
    sizeId: "1:1",
    thumbnail: "/examples/pwr-core-cutaway.jpg",
    seed: 1000,
  },
  {
    title: "Cherenkov glow",
    category: "Physics",
    prompt: "Cherenkov radiation glowing blue in the pool of a research reactor core, photograph",
    sizeId: "1:1",
    thumbnail: "/examples/cherenkov-glow.jpg",
    seed: 2000,
  },
  {
    title: "Containment dome at dusk",
    category: "Facilities",
    prompt: "Nuclear power plant containment dome at dusk, long exposure photograph",
    sizeId: "1:1",
    thumbnail: "/examples/containment-dome-at-dusk.jpg",
    seed: 1002,
  },
  {
    title: "Spent fuel pool",
    category: "Fuel cycle",
    prompt: "Spent fuel pool from above, deep blue Cherenkov glow around the fuel racks",
    sizeId: "1:1",
    thumbnail: "/examples/spent-fuel-pool.jpg",
    seed: 1003,
  },
  {
    title: "Steam generator tube bundle",
    category: "Reactor systems",
    prompt: "Steam generator tube bundle, cutaway, technical illustration",
    sizeId: "1:1",
    thumbnail: "/examples/steam-generator-tube-bundle.jpg",
    seed: 1004,
  },
  {
    title: "TRISO fuel particle",
    category: "Fuel cycle",
    prompt: "TRISO fuel particle cross-section showing its coating layers, macro photograph",
    sizeId: "1:1",
    thumbnail: "/examples/triso-fuel-particle.jpg",
    seed: 1005,
  },
  {
    title: "Tokamak vacuum vessel",
    category: "Facilities",
    prompt: "Interior of a tokamak fusion reactor vacuum vessel, photograph",
    sizeId: "1:1",
    thumbnail: "/examples/tokamak-vacuum-vessel.jpg",
    seed: 3001,
  },
  {
    title: "ZETA fusion experiment",
    category: "Physics",
    // The model card's own example prompt.
    prompt: "A model of the ZETA generator, Britain's first nuclear fusion experiment",
    sizeId: "1:1",
    thumbnail: "/examples/zeta-fusion-experiment.jpg",
    seed: 3000,
  },
];
