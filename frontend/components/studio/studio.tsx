"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Menu, SlidersHorizontal } from "lucide-react";
import { Dialog } from "radix-ui";
import { toast } from "sonner";
import { Composer } from "@/components/studio/composer";
import { Explore } from "@/components/studio/explore";
import { Feed } from "@/components/studio/feed";
import { Lightbox } from "@/components/studio/lightbox";
import { SettingsPanel } from "@/components/studio/settings-panel";
import { IconButton, Sidebar, type ModelStatus } from "@/components/studio/sidebar";
import { NAV_QUERY, useMediaQuery, WIDE_QUERY } from "@/hooks/use-media-query";
import { useStudio } from "@/hooks/use-studio";
import { ERROR_CODES, type GeneratedImage } from "@/lib/contract";
import type { Example } from "@/lib/examples";
import { loadLayout, loadSettings, saveLayout, saveSettings, type Layout } from "@/lib/storage";
import {
  activeThread,
  DEFAULT_SETTINGS,
  runningTurn,
  type Settings,
  type StudioState,
  type Thread,
  type Turn,
} from "@/lib/studio-state";
import { cn } from "@/lib/utils";

const DEFAULT_LAYOUT: Layout = { navCollapsed: false, panelOpen: true };

export function Studio({ mode }: { mode: "mock" | "live" }) {
  const studio = useStudio();
  const { state } = studio;
  const thread = activeThread(state);
  const running = runningTurn(state);
  const generating = running !== null;

  const [prompt, setPrompt] = useState("");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [layout, setLayout] = useState<Layout>(DEFAULT_LAYOUT);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [lightbox, setLightbox] = useState<{ turnId: string; index: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const wide = useMediaQuery(WIDE_QUERY);
  const navInline = useMediaQuery(NAV_QUERY);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  // Preferences load after mount so the server render and first client render match.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- one-time read of browser-only storage */
    setSettings(loadSettings());
    setLayout(loadLayout() ?? DEFAULT_LAYOUT);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);
  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => saveLayout(layout), [layout]);

  // Sidebar groups ("Today") roll over without a reload.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const panelOpen = wide ? layout.panelOpen : sheetOpen;
  const setPanelOpen = (open: boolean) => {
    if (wide) setLayout((current) => ({ ...current, panelOpen: open }));
    else setSheetOpen(open);
  };

  // The feed reads like a chat: it opens at the newest turn and stays pinned there while images arrive.
  const threadId = thread?.id ?? null;
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    pinnedRef.current = true;
    scroller.scrollTop = threadId ? scroller.scrollHeight : 0;
  }, [threadId]);

  const turnCount = thread?.turns.length ?? 0;
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || turnCount === 0) return;
    pinnedRef.current = true;
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [turnCount]);

  useEffect(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    const observer = new ResizeObserver(() => {
      if (pinnedRef.current && threadId) scroller.scrollTop = scroller.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [threadId]);

  const focusPrompt = () => {
    const field = promptRef.current;
    if (!field) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  };

  const submit = () => {
    const text = prompt.trim();
    if (!text) {
      focusPrompt();
      return;
    }
    if (studio.run({ ...settings, prompt: text })) setPrompt("");
  };

  const cancel = () => {
    if (!running) return;
    // Hand the cancelled prompt back so it can be edited and sent again.
    if (!prompt.trim()) setPrompt(running.request.prompt);
    studio.cancel();
  };

  // Cmd/Ctrl+Enter generates from anywhere; Escape cancels a running generation.
  // The listener subscribes once and reads the latest handlers through a ref.
  const keysRef = useRef({ submit, cancel, generating });
  useEffect(() => {
    keysRef.current = { submit, cancel, generating };
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const keys = keysRef.current;
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        if (!keys.generating) keys.submit();
      } else if (event.key === "Escape" && keys.generating && !document.querySelector('[role="dialog"]')) {
        keys.cancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const loadIntoComposer = (turn: Turn, patch: Partial<Settings> = {}) => {
    const { prompt: text, ...rest } = turn.request;
    setPrompt(text);
    setSettings({ ...rest, ...patch });
    requestAnimationFrame(focusPrompt);
  };

  const actions = {
    onDownload: downloadImage,
    onCopySeed: (image: GeneratedImage) => {
      navigator.clipboard
        .writeText(String(image.seed))
        .then(() => toast.success(`Seed ${image.seed} copied`))
        .catch(() => toast.error("Couldn't copy the seed. Select it from the image instead."));
    },
    onVary: (turn: Turn, image: GeneratedImage) => {
      loadIntoComposer(turn, { seed: image.seed, numImages: 1 });
      setAdvancedOpen(true);
      toast(`Loaded seed ${image.seed}. Edit the prompt, then generate.`);
    },
    onOpen: (turn: Turn, index: number) => setLightbox({ turnId: turn.id, index }),
    onRegenerate: (turn: Turn) => {
      studio.run({ ...turn.request, seed: null });
    },
    onEditPrompt: (turn: Turn) => loadIntoComposer(turn),
    onRetry: (turn: Turn) => studio.retry(turn.id),
    onCancel: cancel,
  };

  const startThread = (focus: boolean) => {
    studio.newThread();
    setDrawerOpen(false);
    if (focus) requestAnimationFrame(focusPrompt);
    else scrollRef.current?.scrollTo({ top: 0 });
  };

  const pickExample = (example: Example) => {
    setPrompt(example.prompt);
    setSettings((current) => ({ ...current, sizeId: example.sizeId }));
    requestAnimationFrame(focusPrompt);
  };

  const deleteThread = (target: Thread) => {
    studio.deleteThread(target.id);
    toast("Thread deleted", { action: { label: "Undo", onClick: () => studio.restoreThread(target) } });
  };

  const status = modelStatus(state);
  const lightboxTurn = lightbox ? (thread?.turns.find((turn) => turn.id === lightbox.turnId) ?? null) : null;

  const sidebar = (collapsed: boolean) => (
    <Sidebar
      threads={state.threads}
      activeThreadId={state.activeThreadId}
      runningThreadId={state.running?.threadId ?? null}
      status={status}
      mode={mode}
      collapsed={collapsed}
      onToggleCollapsed={navInline ? () => setLayout((current) => ({ ...current, navCollapsed: !current.navCollapsed })) : undefined}
      onClose={navInline ? undefined : () => setDrawerOpen(false)}
      onNewThread={() => startThread(true)}
      onExplore={() => startThread(false)}
      onSelect={(threadId) => {
        studio.select(threadId);
        setDrawerOpen(false);
      }}
      onDelete={deleteThread}
      now={now}
    />
  );

  const panel = (
    <SettingsPanel
      settings={settings}
      onChange={(patch) => setSettings((current) => ({ ...current, ...patch }))}
      onReset={() => setSettings(DEFAULT_SETTINGS)}
      onClose={() => setPanelOpen(false)}
      status={status}
      mode={mode}
      advancedOpen={advancedOpen}
      onAdvancedOpenChange={setAdvancedOpen}
    />
  );

  return (
    <div className="flex h-dvh overflow-hidden">
      {navInline && (
        <aside
          aria-label="Sidebar"
          className={cn(
            "flex-none border-r border-line bg-panel transition-[width] duration-200",
            layout.navCollapsed ? "w-16" : "w-[264px]",
          )}
        >
          {sidebar(layout.navCollapsed)}
        </aside>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 flex-none items-center gap-2.5 border-b border-line pr-3.5 pl-2.5 nav:pl-6">
          {!navInline && (
            <IconButton label="Open threads" onClick={() => setDrawerOpen(true)}>
              <Menu />
            </IconButton>
          )}
          <div className="min-w-0 flex-1 truncate text-[14.5px] font-medium">{thread?.title ?? "New thread"}</div>
          <IconButton label="Run settings" pressed={panelOpen} onClick={() => setPanelOpen(!panelOpen)}>
            <SlidersHorizontal />
          </IconButton>
        </header>

        <div
          ref={scrollRef}
          onScroll={(event) => {
            const target = event.currentTarget;
            pinnedRef.current = target.scrollHeight - target.scrollTop - target.clientHeight < 120;
          }}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <div ref={contentRef}>
            {thread ? <Feed thread={thread} busy={generating} {...actions} /> : state.hydrated && <Explore onPick={pickExample} />}
          </div>
        </div>

        <div className="flex-none px-3 pb-3 nav:px-7 nav:pb-3.5">
          <Composer
            prompt={prompt}
            onPromptChange={setPrompt}
            settings={settings}
            generating={generating}
            onSubmit={submit}
            onStop={cancel}
            onOpenSettings={() => setPanelOpen(true)}
            promptRef={promptRef}
          />
          <p className="mx-auto mt-2 max-w-[800px] text-center text-xs text-fg-subtle">
            Images are synthetic. Check technical details against real references before relying on them.
          </p>
        </div>
      </main>

      {wide ? (
        panelOpen && (
          <aside aria-label="Run settings" className="w-[316px] flex-none border-l border-line bg-panel">
            {panel}
          </aside>
        )
      ) : (
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen} side="right" title="Run settings">
          {panel}
        </Sheet>
      )}

      {!navInline && (
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen} side="left" title="Threads">
          {sidebar(false)}
        </Sheet>
      )}

      <Lightbox
        turn={lightboxTurn}
        index={lightbox?.index ?? 0}
        onIndexChange={(index) => setLightbox((current) => (current ? { ...current, index } : current))}
        onClose={() => setLightbox(null)}
        onDownload={actions.onDownload}
        onCopySeed={actions.onCopySeed}
      />

      <p aria-live="polite" className="sr-only">
        {announcement(running, thread)}
      </p>
    </div>
  );
}

/** A side panel on small screens, as a modal dialog with focus management and Escape to close. */
function Sheet({
  open,
  onOpenChange,
  side,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side: "left" | "right";
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/55 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-describedby={undefined}
          // A toast's action (Undo) is part of the flow, not a click outside the sheet.
          onInteractOutside={(event) => {
            if ((event.target as Element | null)?.closest("[data-sonner-toaster]")) event.preventDefault();
          }}
          className={cn(
            "fixed inset-y-0 z-40 w-[min(360px,90vw)] bg-panel shadow-[0_0_60px_-10px_#000] outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
            side === "right"
              ? "right-0 border-l border-line data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right"
              : "left-0 border-r border-line data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left",
          )}
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function modelStatus(state: StudioState): ModelStatus {
  if (state.running) return { label: "Generating", tone: "active" };
  const latest = state.threads[0]?.turns.at(-1);
  if (latest?.status === "error" && latest.failure?.code === ERROR_CODES.coldStart) return { label: "Starting up", tone: "warn" };
  return { label: "Ready", tone: "ready" };
}

function announcement(running: Turn | null, thread: Thread | null): string {
  if (running) return "Generating.";
  const latest = thread?.turns.at(-1);
  if (!latest) return "";
  if (latest.status === "error") return `Generation failed. ${latest.failure?.message ?? ""}`;
  const count = latest.images.length;
  return `${count === 1 ? "Image" : `${count} images`} ready.`;
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function downloadImage(image: GeneratedImage) {
  const mime = /^data:image\/([\w+.-]+)[;,]/.exec(image.image)?.[1] ?? "png";
  const extension = mime === "svg+xml" ? "svg" : mime === "jpeg" ? "jpg" : mime;
  const link = document.createElement("a");
  link.href = image.image;
  link.download = `nucleardiffusion-${image.seed}.${extension}`;
  document.body.append(link);
  link.click();
  link.remove();
}
