import { MODEL } from "@/lib/contract";

/**
 * The models the studio can run, as shown in the model picker.
 *
 * Every fact here comes from the NuclearDiffusion paper (arXiv:2608.04030) or
 * the model's Hugging Face card; do not add a claim that neither source makes.
 * There is one model today, so a request does not name one. A second model
 * adds a `model` field to the contract (lib/contract.ts and docs/API.md).
 */
export type ModelInfo = {
  /** Hugging Face repo; the backend reports it as `model` on every result. */
  id: string;
  name: string;
  /** One line for the run settings panel. */
  summary: string;
  description: string;
  /** What goes in and out, at what size, on what base. */
  task: string;
  trainingData: string;
  /** What the model is known to do badly, so prompts can avoid it. */
  limitations: string;
  /** ISO date the weights were published. */
  released: string;
  license: string;
  paperUrl: string;
  cardUrl: string;
};

export const PAPER_URL = "https://arxiv.org/abs/2608.04030";

export const MODELS: readonly ModelInfo[] = [
  {
    id: MODEL.id,
    name: "NuclearDiffusion SDXL",
    summary: "SDXL fine\u2011tuned on nuclear energy imagery, from the NuclearDiffusion study.",
    // Non-breaking hyphens (\u2011) keep "fine-tuned" from splitting across lines.
    description:
      "Stable Diffusion XL with its UNet fine\u2011tuned on nuclear energy imagery. Of the open models in the NuclearDiffusion study, fine\u2011tuning improved SDXL the most.",
    task: "Text to image • 1024×1024 • SDXL 1.0 base",
    trainingData: "1,000 captioned images of reactors, fuel cycles and radiation, from books, papers and news sites",
    limitations: "Can't write legible labels or text, and abstract diagrams come out weak",
    released: "2026-07-20",
    license: "Apache 2.0",
    paperUrl: PAPER_URL,
    cardUrl: `https://huggingface.co/${MODEL.id}`,
  },
];

/** The model every request runs on. */
export const CURRENT_MODEL = MODELS[0];

export function formatReleaseDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
