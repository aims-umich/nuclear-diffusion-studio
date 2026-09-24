import { z } from "zod";
import { AppliedParamsSchema, GeneratedImageSchema, LIMITS, SIZE_PRESETS, type SizeId } from "@/lib/contract";
import { DEFAULT_SETTINGS, type Settings, type Thread } from "@/lib/studio-state";

/**
 * Browser persistence.
 *
 * Threads live in IndexedDB: real model output is a PNG data URL of a few
 * megabytes, far beyond localStorage's ~5 MB quota. Small preferences (run
 * settings, panel layout) live in localStorage. Every read is validated, so a
 * record from an older build or a tampered store is dropped instead of
 * crashing the app. Storage can be unavailable (private windows, blocked site
 * data); the app then works normally without saving.
 */

const DB_NAME = "nuclear-diffusion-studio";
const DB_VERSION = 1;
const STORE = "threads";

const SIZE_IDS = SIZE_PRESETS.map((preset) => preset.id) as [SizeId, ...SizeId[]];

const SettingsSchema = z.object({
  negativePrompt: z.string().max(LIMITS.negativePromptMaxLength),
  steps: z.int().min(LIMITS.steps.min).max(LIMITS.steps.max),
  guidance: z.number().min(LIMITS.guidance.min).max(LIMITS.guidance.max),
  sizeId: z.enum(SIZE_IDS),
  numImages: z.int().min(LIMITS.images.min).max(LIMITS.images.max),
  seed: z.int().min(0).max(LIMITS.seedMax).nullable(),
});

const ThreadSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  turns: z.array(
    z.object({
      id: z.string(),
      createdAt: z.number(),
      request: SettingsSchema.extend({ prompt: z.string() }),
      status: z.enum(["done", "error"]),
      step: z.number(),
      totalSteps: z.number(),
      seed: z.number().nullable(),
      images: z.array(GeneratedImageSchema),
      params: AppliedParamsSchema.nullable(),
      timingMs: z.number().nullable(),
      failure: z
        .object({
          code: z.string(),
          message: z.string(),
          status: z.number().nullable(),
          retryAfterSeconds: z.number().nullable(),
        })
        .nullable(),
    }),
  ),
});

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB is unavailable"));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/**
 * Saves threads incrementally: only threads whose `updatedAt` changed since the
 * last save are rewritten, so a history of large PNGs is not re-serialized on
 * every change.
 */
export class ThreadStore {
  private db: Promise<IDBDatabase> | null = null;
  private saved = new Map<string, number>();
  private queue: Promise<void> = Promise.resolve();

  private database() {
    this.db ??= openDatabase();
    return this.db;
  }

  async load(): Promise<Thread[]> {
    try {
      const db = await this.database();
      const transaction = db.transaction(STORE, "readonly");
      const request = transaction.objectStore(STORE).getAll();
      await done(transaction);
      const threads = (request.result as unknown[]).flatMap((value) => {
        const parsed = ThreadSchema.safeParse(value);
        return parsed.success ? [parsed.data as Thread] : [];
      });
      for (const thread of threads) this.saved.set(thread.id, thread.updatedAt);
      return threads;
    } catch (error) {
      console.warn("[storage] history is unavailable in this browser", error);
      return [];
    }
  }

  /** Queue a save of exactly this set of threads; missing ones are deleted. */
  save(threads: Thread[]): Promise<void> {
    this.queue = this.queue.then(() => this.write(threads)).catch((error) => {
      console.warn("[storage] could not save history", error);
    });
    return this.queue;
  }

  private async write(threads: Thread[]) {
    const changed = threads.filter((thread) => this.saved.get(thread.id) !== thread.updatedAt);
    const current = new Set(threads.map((thread) => thread.id));
    const removed = [...this.saved.keys()].filter((id) => !current.has(id));
    if (changed.length === 0 && removed.length === 0) return;

    const db = await this.database();
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    for (const thread of changed) store.put(thread);
    for (const id of removed) store.delete(id);
    await done(transaction);

    for (const thread of changed) this.saved.set(thread.id, thread.updatedAt);
    for (const id of removed) this.saved.delete(id);
  }
}

const SETTINGS_KEY = "nd-studio:settings";
const LAYOUT_KEY = "nd-studio:layout";

export type Layout = { navCollapsed: boolean; panelOpen: boolean };

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage is full or blocked; preferences simply do not persist.
  }
}

export function loadSettings(): Settings {
  const parsed = SettingsSchema.safeParse(readJson(SETTINGS_KEY));
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export function saveSettings(settings: Settings) {
  writeJson(SETTINGS_KEY, settings);
}

const LayoutSchema = z.object({ navCollapsed: z.boolean(), panelOpen: z.boolean() });

export function loadLayout(): Layout | null {
  const parsed = LayoutSchema.safeParse(readJson(LAYOUT_KEY));
  return parsed.success ? parsed.data : null;
}

export function saveLayout(layout: Layout) {
  writeJson(LAYOUT_KEY, layout);
}
