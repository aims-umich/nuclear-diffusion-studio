import { describe, expect, it } from "vitest";
import { MODEL } from "@/lib/contract";
import { CURRENT_MODEL, formatReleaseDate, MODELS } from "@/lib/models";

describe("models", () => {
  it("runs the model the backend serves", () => {
    expect(CURRENT_MODEL.id).toBe(MODEL.id);
    expect(new Set(MODELS.map((model) => model.id)).size).toBe(MODELS.length);
  });

  it("formats a release date without shifting it across time zones", () => {
    expect(formatReleaseDate("2026-07-20")).toBe("Jul 20, 2026");
    expect(formatReleaseDate("2026-01-01")).toBe("Jan 1, 2026");
  });
});
