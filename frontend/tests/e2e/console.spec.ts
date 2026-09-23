import { expect, test, type Page } from "@playwright/test";

const EXAMPLE = "Cutaway of a PWR core, fuel assemblies and control rods";

const prompt = (page: Page) => page.getByRole("textbox", { name: "Prompt" });
const seedInput = (page: Page) => page.getByRole("textbox", { name: "Seed" });
const generateButton = (page: Page) => page.getByRole("button", { name: /^Generate/ });
const status = (page: Page) => page.getByTestId("connection-status");
const resultImage = (page: Page) => page.getByTestId("result-image");

// Next.js renders its own role="alert" route announcer, so scope to the console's error view.
const errorView = (page: Page) =>
  page.getByRole("alert").filter({ has: page.getByRole("button", { name: "Retry generation" }) });

async function startFromExample(page: Page) {
  await page.getByRole("button", { name: EXAMPLE }).click();
  await generateButton(page).click();
}

async function generateFromExample(page: Page) {
  await startFromExample(page);
  await expect(resultImage(page)).toBeVisible();
}

test.describe("inference console", () => {
  test("opens idle, matching the base design", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("NuclearDiffusion Studio");
    await expect(page.getByText("AWAITING PROMPT")).toBeVisible();
    await expect(status(page)).toHaveText("Idle");
    await expect(page.getByText("nd-xl · fp16 · mock")).toBeVisible();
    await expect(page.getByRole("radio", { name: "1024 by 1024 pixels" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("region", { name: "Session history" })).toHaveCount(0);
  });

  test("streams progress, then shows the result and records it in the session", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: EXAMPLE }).click();
    await expect(prompt(page)).toHaveValue(EXAMPLE);
    await expect(page.getByText("55 / 500")).toBeVisible();

    await generateButton(page).click();
    await expect(status(page)).toHaveText("Generating");
    await expect(page.getByRole("progressbar", { name: "Generation progress" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Generating\s*step \d+ \/ 30/ })).toBeDisabled();

    // Progress must actually advance mid-stream, not jump straight to the end.
    await expect
      .poll(async () => Number(await page.getByRole("progressbar").getAttribute("aria-valuenow")))
      .toBeGreaterThan(0);

    await expect(resultImage(page)).toBeVisible();
    await expect(status(page)).toHaveText("Ready");
    await expect(page.getByText(`“${EXAMPLE}”`)).toBeVisible();
    const meta = page.locator("dl");
    await expect(meta).toContainText("steps30");
    await expect(meta).toContainText("guidance7.5");
    await expect(meta).toContainText("samplereuler_a");
    await expect(meta).toContainText("size1024²");

    const session = page.getByRole("region", { name: "Session history" });
    await expect(session.getByText("1 generation")).toBeVisible();
    await expect(session.getByRole("button", { name: `Generation 1: ${EXAMPLE}` })).toHaveAttribute("aria-current", "true");
  });

  test("asks for a prompt instead of generating an empty one", async ({ page }) => {
    await page.goto("/");
    await generateButton(page).click();
    await expect(page.getByText("Describe what to generate first.")).toBeVisible();
    await expect(prompt(page)).toBeFocused();
    await expect(prompt(page)).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("AWAITING PROMPT")).toBeVisible();

    await prompt(page).fill("Spent fuel pool, blue glow");
    await expect(page.getByText("Describe what to generate first.")).toHaveCount(0);
  });

  test("generates with the keyboard shortcut and cancels with Escape", async ({ page }) => {
    await page.goto("/?mock=slow");
    await prompt(page).fill("Boiling water reactor schematic");
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(status(page)).toHaveText("Generating");
    await page.keyboard.press("Escape");
    await expect(page.getByText("AWAITING PROMPT")).toBeVisible();
    await expect(status(page)).toHaveText("Idle");
    await expect(generateButton(page)).toBeEnabled();
  });

  test("recovers from a cold start with Retry", async ({ page }) => {
    await page.goto("/?mock=cold-start");
    await startFromExample(page);
    const alert = errorView(page);
    await expect(alert.getByRole("heading", { name: "Reactor offline" })).toBeVisible();
    await expect(alert).toContainText("ERR_COLD_START · 503 · endpoint warming ~20s");
    await expect(status(page)).toHaveText("Offline");
    await expect(prompt(page)).toHaveValue(EXAMPLE);

    // The endpoint has "warmed up": drop the forced scenario and retry the same draft.
    await page.evaluate(() => history.replaceState(null, "", "/"));
    await alert.getByRole("button", { name: "Retry generation" }).click();
    await expect(resultImage(page)).toBeVisible();
    await expect(status(page)).toHaveText("Ready");
  });

  test("surfaces a mid-stream inference failure", async ({ page }) => {
    await page.goto("/?mock=inference-error");
    await startFromExample(page);
    const alert = errorView(page);
    await expect(alert.getByRole("heading", { name: "Generation failed" })).toBeVisible();
    await expect(alert).toContainText("ERR_INFERENCE");
    await expect(status(page)).toHaveText("Error");
  });

  test("reproduces an image from a fixed seed and varies it on regenerate", async ({ page }) => {
    await page.goto("/");
    await prompt(page).fill("Containment dome at dusk, long exposure");
    await seedInput(page).fill("742199304");
    await generateButton(page).click();
    await expect(resultImage(page)).toBeVisible();
    await expect(page.getByText("SEED 742199304", { exact: true })).toBeVisible();
    const first = await resultImage(page).getAttribute("src");

    await generateButton(page).click();
    await expect(page.getByText("2 generations")).toBeVisible();
    expect(await resultImage(page).getAttribute("src")).toBe(first);

    await page.getByRole("button", { name: "Regenerate" }).click();
    await expect(page.getByText("3 generations")).toBeVisible();
    await expect(resultImage(page)).not.toHaveAttribute("src", first!);
    await expect(seedInput(page)).toHaveValue("");

    // History: the oldest thumbnail restores that exact generation.
    await page.getByRole("button", { name: /^Generation 1:/ }).click();
    await expect(resultImage(page)).toHaveAttribute("src", first!);
    await expect(page.getByRole("button", { name: /^Generation 1:/ })).toHaveAttribute("aria-current", "true");
  });

  test("loads a result back into the composer as a variation", async ({ page }) => {
    await page.goto("/");
    await generateFromExample(page);
    const seed = (await page.getByText(/^SEED \d+$/).textContent())!.replace("SEED ", "");

    await prompt(page).fill("something else entirely");
    await page.getByRole("button", { name: "Use as variation" }).click();
    await expect(prompt(page)).toHaveValue(EXAMPLE);
    await expect(prompt(page)).toBeFocused();
    await expect(seedInput(page)).toHaveValue(seed);
    await expect(page.getByText("Settings loaded with the same seed")).toBeVisible();
  });

  test("respects the chosen size and parameters", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("radio", { name: "512 by 512 pixels" }).click();
    await expect(page.getByText("nd-xl · 512²")).toBeVisible();

    const steps = page.getByRole("slider", { name: "Steps" });
    await steps.focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(steps).toHaveAttribute("aria-valuenow", "28");

    await generateFromExample(page);
    await expect(page.locator("dl")).toContainText("steps28");
    await expect(page.locator("dl")).toContainText("size512²");
    await expect(resultImage(page)).toHaveAttribute("width", "512");
  });

  test("starts a fresh composition from the session strip", async ({ page }) => {
    await page.goto("/");
    await generateFromExample(page);
    await page.getByRole("button", { name: "Start a new generation" }).click();
    await expect(page.getByText("AWAITING PROMPT")).toBeVisible();
    await expect(prompt(page)).toHaveValue("");
    await expect(prompt(page)).toBeFocused();
    await expect(page.getByText("1 generation")).toBeVisible();
  });

  test("downloads the image with a seed-stamped filename", async ({ page }) => {
    await page.goto("/");
    await seedInput(page).fill("1234");
    await generateFromExample(page);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("nucleardiffusion-1234.svg");
  });

  test("copies the seed to the clipboard", async ({ page, context, browserName }) => {
    test.skip(browserName !== "chromium", "Clipboard permissions are Chromium-only in Playwright");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");
    await seedInput(page).fill("99");
    await generateFromExample(page);
    await page.getByRole("button", { name: "Copy seed" }).click();
    await expect(page.getByText("Seed 99 copied")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("99");
  });

  test("keeps progress in view after Generate, even when the layout is stacked", async ({ page }) => {
    await page.goto("/?mock=slow");
    await startFromExample(page);
    await expect(page.getByRole("progressbar", { name: "Generation progress" })).toBeInViewport();
  });

  test("never scrolls horizontally", async ({ page }) => {
    await page.goto("/");
    await generateFromExample(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
