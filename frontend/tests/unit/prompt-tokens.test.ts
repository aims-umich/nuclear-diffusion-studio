import { describe, expect, it } from "vitest";
import { estimatePromptTokens, exceedsPromptTokens } from "@/lib/prompt-tokens";

describe("estimatePromptTokens", () => {
  it("counts short words, digits, and punctuation like CLIP's pre-tokenizer", () => {
    expect(estimatePromptTokens("")).toBe(0);
    expect(estimatePromptTokens("a reactor core")).toBe(3);
    expect(estimatePromptTokens("core, dome.")).toBe(4);
    // CLIP splits numbers into single digits.
    expect(estimatePromptTokens("1024")).toBe(4);
  });

  it("charges long words more than one token", () => {
    expect(estimatePromptTokens("pressurized")).toBe(3);
    expect(estimatePromptTokens("PRESSURIZED")).toBe(estimatePromptTokens("pressurized"));
  });

  it("flags prompts past the 75-token window", () => {
    const short = "Cutaway of a pressurized-water reactor core, fuel assemblies and control rods";
    expect(exceedsPromptTokens(short)).toBe(false);
    expect(exceedsPromptTokens(`${short}, `.repeat(4))).toBe(false);
    expect(exceedsPromptTokens(`${short}, `.repeat(5))).toBe(true);
  });
});
