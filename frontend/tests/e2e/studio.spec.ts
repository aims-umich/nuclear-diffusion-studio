import { expect, test, type Page } from "@playwright/test";

const EXAMPLE = "PWR core cutaway";
const EXAMPLE_PROMPT = "Cutaway of a pressurized-water reactor core, fuel assemblies and control rods, technical illustration";

const prompt = (page: Page) => page.getByRole("textbox", { name: "Prompt", exact: true });
const generateButton = (page: Page) => page.getByRole("button", { name: "Generate", exact: true });
const stopButton = (page: Page) => page.getByRole("button", { name: "Stop generating" });
const status = (page: Page) => page.getByTestId("model-status");
const results = (page: Page) => page.getByTestId("result-image");
const progress = (page: Page) => page.getByRole("progressbar", { name: "Generation progress" });
const threads = (page: Page) => page.getByRole("navigation", { name: "Threads" });

// Next.js renders its own role="alert" route announcer, so scope to the turn's error card.
const errorCard = (page: Page) => page.getByRole("alert").filter({ has: page.getByRole("button", { name: "Retry" }) });

const explore = (page: Page) => page.getByRole("heading", { name: "Visualize nuclear energy concepts" });

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1440) < 860;

/** The settings panel is inline on wide screens and a dialog on narrow ones; open it either way. */
async function settings(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Run settings" });
  const inline = page.getByRole("complementary", { name: "Run settings" });
  if (await inline.isVisible()) return inline;
  if (!(await dialog.isVisible())) await page.getByRole("button", { name: "Run settings", exact: true }).click();
  await expect(dialog).toBeVisible();
  return dialog;
}

async function closeSettings(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Run settings" });
  if (!(await dialog.isVisible())) return;
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
}

async function openAdvanced(page: Page) {
  const panel = await settings(page);
  const toggle = panel.getByRole("button", { name: "Advanced" });
  if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
  return panel;
}

async function generateFromExample(page: Page) {
  await page.getByRole("button", { name: EXAMPLE }).click();
  await generateButton(page).click();
  await expect(results(page).first()).toBeVisible();
}

async function fixSeed(page: Page, seed: string) {
  const panel = await openAdvanced(page);
  await panel.getByRole("switch", { name: "Random" }).click();
  await panel.getByRole("textbox", { name: "Seed" }).fill(seed);
  await closeSettings(page);
}

test.describe("studio", () => {
  test("opens on the explore page with the model-card defaults", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("NuclearDiffusion Studio");
    await expect(explore(page)).toBeVisible();
    await expect(page.getByRole("button", { name: EXAMPLE })).toBeVisible();
    await expect(generateButton(page)).toBeDisabled();

    const panel = await settings(page);
    await expect(panel.getByRole("radio", { name: "1:1, 1024 by 1024" })).toHaveAttribute("aria-checked", "true");
    await expect(panel.getByRole("radio", { name: "1 image" })).toHaveAttribute("aria-checked", "true");
    await expect(panel.getByRole("slider", { name: "Steps" })).toHaveAttribute("aria-valuenow", "50");
    await expect(panel.getByRole("slider", { name: "Guidance" })).toHaveAttribute("aria-valuetext", "5.0");
    await expect(panel.getByText("Mock engine: images are placeholders")).toBeVisible();
  });

  test("streams progress, then records the result in a new thread", async ({ page }) => {
    await page.goto("/?mock=slow");
    await page.getByRole("button", { name: EXAMPLE }).click();
    await expect(prompt(page)).toHaveValue(EXAMPLE_PROMPT);
    await generateButton(page).click();

    await expect(progress(page)).toBeVisible();
    await expect(progress(page)).toBeInViewport();
    await expect(stopButton(page)).toBeVisible();
    // Progress must actually advance mid-stream, not jump straight to the end.
    await expect.poll(async () => Number(await progress(page).getAttribute("aria-valuenow"))).toBeGreaterThan(0);
    await expect(prompt(page)).toHaveValue("");

    await expect(results(page)).toHaveCount(1, { timeout: 30_000 });
    const turn = page.getByRole("article", { name: `Generation: ${EXAMPLE_PROMPT}` });
    await expect(turn.getByRole("list", { name: "Settings" })).toHaveText(/1:1\s*1024×1024\s*50 steps\s*guidance 5\.0\s*euler/);
    await expect(results(page)).toHaveAttribute("width", "1024");

    if (isMobile(page)) await page.getByRole("button", { name: "Open threads" }).click();
    await expect(threads(page).getByRole("button", { name: EXAMPLE_PROMPT, exact: true })).toHaveAttribute("aria-current", "page");
    await expect(status(page)).toHaveText("Ready");
  });

  test("explains the wait while a sleeping GPU wakes up", async ({ page }) => {
    await page.goto("/?mock=waking");
    await prompt(page).fill("Containment dome at dusk");
    await prompt(page).press("Enter");

    await expect(progress(page)).toHaveAttribute("aria-valuetext", "Starting");
    await expect(progress(page)).toHaveAttribute("aria-valuetext", "Waking the GPU");
    const hint = page.getByText("The GPU sleeps when idle, so the first run can take up to a minute.");
    await expect(hint).toBeVisible();

    await expect(results(page)).toHaveCount(1, { timeout: 30_000 });
    await expect(hint).toHaveCount(0);
  });

  test("generates a batch at an experimental size, one seed per image", async ({ page }) => {
    await page.goto("/");
    const panel = await settings(page);
    await panel.getByRole("radio", { name: "16:9, 1344 by 768, experimental" }).click();
    await expect(panel.getByText("Experimental. This model was fine-tuned on square images")).toBeVisible();
    await panel.getByRole("radio", { name: "3 images" }).click();
    await closeSettings(page);
    await fixSeed(page, "4294967294");

    await expect(page.getByRole("button", { name: "3 images per run. Change in run settings" })).toBeVisible();
    await prompt(page).fill("Cooling towers in fog");
    await prompt(page).press("Enter");

    await expect(results(page)).toHaveCount(3);
    await expect(results(page).first()).toHaveAttribute("width", "1344");
    await expect(page.getByText(/^seed \d+$/)).toHaveText(["seed 4294967294", "seed 4294967295", "seed 0"]);
  });

  test("opens the model card from run settings", async ({ page }) => {
    await page.goto("/");
    const panel = await settings(page);
    const modelButton = panel.getByRole("button", { name: /^NuclearDiffusion SDXL/ });
    await modelButton.click();

    const models = page.getByRole("dialog", { name: "Models" });
    const card = models.getByRole("listitem").filter({ hasText: "kumo24/sdxl_nuclear" });
    await expect(card.getByRole("button", { name: "NuclearDiffusion SDXL" })).toHaveAttribute("aria-current", "true");
    await expect(card.getByText("Released Jul 20, 2026 • Apache 2.0 license")).toBeVisible();
    await expect(card.getByRole("link", { name: /^NuclearDiffusion paper/ })).toHaveAttribute("href", "https://arxiv.org/abs/2608.04030");
    await expect(card.getByRole("link", { name: /^Open the model card/ })).toHaveAttribute(
      "href",
      "https://huggingface.co/kumo24/sdxl_nuclear",
    );

    // Escape closes only the model list; on a narrow screen the settings sheet stays open beneath it.
    await page.keyboard.press("Escape");
    await expect(models).toHaveCount(0);
    await expect(modelButton).toBeFocused();
    await expect(panel).toBeVisible();

    // Picking the model in use just closes the list.
    await modelButton.click();
    await card.getByRole("button", { name: "NuclearDiffusion SDXL" }).click();
    await expect(models).toHaveCount(0);
  });

  test("sends with Enter, adds lines with Shift+Enter, and needs a prompt", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(prompt(page)).toBeFocused();

    await prompt(page).fill("Boiling water reactor");
    await prompt(page).press("Shift+Enter");
    await prompt(page).pressSequentially("schematic");
    await expect(prompt(page)).toHaveValue("Boiling water reactor\nschematic");
    await prompt(page).press("Enter");
    await expect(results(page)).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "Boiling water reactor schematic" })).toBeAttached();
  });

  test("cancels with Escape and hands the prompt back", async ({ page }) => {
    await page.goto("/?mock=slow");
    await prompt(page).fill("Boiling water reactor schematic");
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(progress(page)).toBeVisible();
    await page.keyboard.press("Escape");

    await expect(progress(page)).toHaveCount(0);
    await expect(prompt(page)).toHaveValue("Boiling water reactor schematic");
    await expect(generateButton(page)).toBeEnabled();
    // A cancelled first turn leaves no empty thread behind.
    await expect(explore(page)).toBeVisible();
  });

  test("recovers from a cold start with Retry", async ({ page }) => {
    await page.goto("/?mock=cold-start");
    await page.getByRole("button", { name: EXAMPLE }).click();
    await generateButton(page).click();
    const alert = errorCard(page);
    await expect(alert.getByRole("heading", { name: "The model is starting up" })).toBeVisible();
    await expect(alert).toContainText("ERR_COLD_START (503)");
    if (!isMobile(page)) await expect(status(page)).toHaveText("Starting up");

    // The endpoint has "warmed up": drop the forced scenario and retry the same turn.
    await page.evaluate(() => {
      const url = new URL(window.location.href);
      url.searchParams.delete("mock");
      history.replaceState(null, "", url);
    });
    await alert.getByRole("button", { name: "Retry" }).click();
    await expect(results(page)).toHaveCount(1);
    await expect(errorCard(page)).toHaveCount(0);
  });

  test("surfaces a mid-stream inference failure", async ({ page }) => {
    await page.goto("/?mock=inference-error");
    await page.getByRole("button", { name: EXAMPLE }).click();
    await generateButton(page).click();
    const alert = errorCard(page);
    await expect(alert.getByRole("heading", { name: "Generation failed" })).toBeVisible();
    await expect(alert).toContainText("ERR_INFERENCE");
  });

  test("reproduces an image from a fixed seed and varies it on regenerate", async ({ page }) => {
    await page.goto("/");
    await fixSeed(page, "742199304");
    await prompt(page).fill("Containment dome at dusk, long exposure");
    await prompt(page).press("Enter");
    await expect(results(page)).toHaveCount(1);
    const first = await results(page).first().getAttribute("src");

    await prompt(page).fill("Containment dome at dusk, long exposure");
    await prompt(page).press("Enter");
    await expect(results(page)).toHaveCount(2);
    expect(await results(page).nth(1).getAttribute("src")).toBe(first);

    await page.getByRole("button", { name: "Regenerate" }).last().click();
    await expect(results(page)).toHaveCount(3);
    expect(await results(page).nth(2).getAttribute("src")).not.toBe(first);
  });

  test("loads an image's seed back into the composer to vary it", async ({ page }) => {
    await page.goto("/");
    await generateFromExample(page);
    const seed = (await page.getByText(/^seed \d+$/).first().textContent())!.replace("seed ", "");

    await prompt(page).fill("something else entirely");
    await page.getByRole("button", { name: "Vary with this seed" }).click();
    await expect(prompt(page)).toHaveValue(EXAMPLE_PROMPT);
    await expect(page.getByText(`Loaded seed ${seed}`)).toBeVisible();
    const panel = await settings(page);
    await expect(panel.getByRole("textbox", { name: "Seed" })).toHaveValue(seed);
  });

  test("keeps threads across reloads, and deletes them with undo", async ({ page }) => {
    await page.goto("/");
    await generateFromExample(page);
    await expect(page).toHaveURL(/\?thread=/);

    await page.reload();
    await expect(results(page)).toHaveCount(1);

    if (isMobile(page)) await page.getByRole("button", { name: "Open threads" }).click();
    await threads(page).getByRole("button", { name: "New thread" }).click();
    await expect(explore(page)).toBeVisible();
    await expect(page).not.toHaveURL(/thread=/);

    if (isMobile(page)) await page.getByRole("button", { name: "Open threads" }).click();
    await threads(page).getByRole("button", { name: `Delete thread: ${EXAMPLE_PROMPT}` }).click();
    await expect(threads(page).getByRole("button", { name: EXAMPLE_PROMPT, exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Undo" }).click();
    await threads(page).getByRole("button", { name: EXAMPLE_PROMPT, exact: true }).click();
    await expect(results(page)).toHaveCount(1);
  });

  test("opens an image full size and steps through its batch", async ({ page }) => {
    await page.goto("/");
    const panel = await settings(page);
    await panel.getByRole("radio", { name: "2 images" }).click();
    await closeSettings(page);
    await generateFromExample(page);
    await expect(results(page)).toHaveCount(2);

    await page.getByRole("button", { name: /^Open full size, seed/ }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("1 of 2")).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(dialog.getByText("2 of 2")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("warns about prompts past the token window and reports the truncation", async ({ page }) => {
    await page.goto("/");
    const long = `${EXAMPLE_PROMPT}, `.repeat(4).slice(0, 480);
    await prompt(page).fill(long);
    await expect(page.getByText("The model reads about the first 75 tokens")).toBeVisible();
    await prompt(page).press("Enter");
    await expect(page.getByText("Only the first 75 tokens of this prompt reached the model.")).toBeVisible();
  });

  test("explains that a negative prompt needs guidance above 1", async ({ page }) => {
    await page.goto("/");
    const panel = await openAdvanced(page);
    await panel.getByRole("textbox", { name: "Negative prompt" }).fill("blurry");
    const guidance = panel.getByRole("slider", { name: "Guidance" });
    await guidance.focus();
    await page.keyboard.press("Home");
    await expect(guidance).toHaveAttribute("aria-valuetext", "1.0");
    await expect(panel.getByText("Has no effect at guidance 1.0")).toBeVisible();
  });

  test("downloads an image with a seed-stamped filename", async ({ page }) => {
    await page.goto("/");
    await fixSeed(page, "1234");
    await generateFromExample(page);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("nucleardiffusion-1234.svg");
  });

  test("copies a seed to the clipboard", async ({ page, context, browserName }) => {
    test.skip(browserName !== "chromium", "Clipboard permissions are Chromium-only in Playwright");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");
    await fixSeed(page, "99");
    await generateFromExample(page);
    await page.getByRole("button", { name: "Copy seed" }).click();
    await expect(page.getByText("Seed 99 copied")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("99");
  });

  test("copies the model ID to the clipboard", async ({ page, context, browserName }) => {
    test.skip(browserName !== "chromium", "Clipboard permissions are Chromium-only in Playwright");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");
    const panel = await settings(page);
    await panel.getByRole("button", { name: /^NuclearDiffusion SDXL/ }).click();
    await page.getByRole("dialog", { name: "Models" }).getByRole("button", { name: "Copy model ID" }).click();
    await expect(page.getByText("Model ID copied")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("kumo24/sdxl_nuclear");
  });

  test("never scrolls horizontally", async ({ page }) => {
    await page.goto("/");
    await generateFromExample(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
