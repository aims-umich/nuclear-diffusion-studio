"use client";

import { ArrowUpRight, Compass, PanelLeftClose, PanelLeftOpen, Plus, Trash2, X } from "lucide-react";
import { MODEL } from "@/lib/contract";
import { groupThreads, type Thread } from "@/lib/studio-state";
import { cn } from "@/lib/utils";

export type ModelStatus = { label: string; tone: "ready" | "active" | "warn" };

type SidebarProps = {
  threads: Thread[];
  activeThreadId: string | null;
  runningThreadId: string | null;
  status: ModelStatus;
  mode: "mock" | "live";
  /** Icon-only rail. The mobile drawer is never collapsed. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** Present in the mobile drawer. */
  onClose?: () => void;
  onNewThread: () => void;
  onExplore: () => void;
  onSelect: (threadId: string) => void;
  onDelete: (thread: Thread) => void;
  now: number;
};

export function Sidebar({
  threads,
  activeThreadId,
  runningThreadId,
  status,
  mode,
  collapsed = false,
  onToggleCollapsed,
  onClose,
  onNewThread,
  onExplore,
  onSelect,
  onDelete,
  now,
}: SidebarProps) {
  const groups = groupThreads(threads, now);
  const exploring = activeThreadId === null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={cn("flex h-14 flex-none items-center gap-2", collapsed ? "justify-center" : "justify-between pr-3 pl-[18px]")}>
        {collapsed ? (
          <IconButton label="Expand sidebar" onClick={onToggleCollapsed}>
            <PanelLeftOpen />
          </IconButton>
        ) : (
          <>
            <Brand />
            {onToggleCollapsed && (
              <IconButton label="Collapse sidebar" onClick={onToggleCollapsed}>
                <PanelLeftClose />
              </IconButton>
            )}
            {onClose && (
              <IconButton label="Close threads" onClick={onClose}>
                <X />
              </IconButton>
            )}
          </>
        )}
      </div>

      <nav aria-label="Threads" className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 pt-1 pb-3">
        <button
          type="button"
          onClick={onNewThread}
          aria-label={collapsed ? "New thread" : undefined}
          title={collapsed ? "New thread" : undefined}
          className={cn(
            "mb-1.5 flex h-10 flex-none items-center gap-2.5 rounded-[10px] border border-line-strong bg-white/3 font-medium text-fg transition-colors hover:bg-white/7",
            collapsed ? "justify-center" : "px-3",
          )}
        >
          <Plus aria-hidden strokeWidth={1.75} className="size-[18px]" />
          {!collapsed && "New thread"}
        </button>
        <button
          type="button"
          onClick={onExplore}
          aria-current={exploring ? "page" : undefined}
          aria-label={collapsed ? "Explore examples" : undefined}
          title={collapsed ? "Explore examples" : undefined}
          className={cn(
            "flex h-9 flex-none items-center gap-2.5 rounded-[9px] text-fg-muted transition-colors hover:bg-white/5 hover:text-fg",
            exploring && "bg-white/8 text-fg",
            collapsed ? "justify-center" : "px-3",
          )}
        >
          <Compass aria-hidden strokeWidth={1.5} className="size-[18px]" />
          {!collapsed && "Explore examples"}
        </button>

        {!collapsed &&
          groups.map((group) => (
            <section key={group.label} aria-label={group.label} className="flex flex-col gap-0.5">
              <h2 className="px-3 pt-[18px] pb-1.5 text-xs font-normal text-fg-subtle">{group.label}</h2>
              <ul className="flex flex-col gap-0.5">
                {group.threads.map((thread) => (
                  <ThreadItem
                    key={thread.id}
                    thread={thread}
                    active={thread.id === activeThreadId}
                    running={thread.id === runningThreadId}
                    onSelect={() => onSelect(thread.id)}
                    onDelete={() => onDelete(thread)}
                  />
                ))}
              </ul>
            </section>
          ))}
      </nav>

      <div className={cn("flex flex-none flex-col gap-2.5 border-t border-line py-4", collapsed ? "items-center" : "px-[18px]")}>
        <div className="flex items-center gap-2.5 text-[12.5px]" title={collapsed ? `${MODEL.label}: ${status.label}` : undefined}>
          <StatusDot tone={status.tone} />
          {!collapsed && (
            <>
              <span className="font-mono">{MODEL.label}</span>
              {mode === "mock" && (
                <span className="rounded-[5px] border border-line-strong px-1.5 py-px text-[11px] text-fg-muted">Mock</span>
              )}
              <span
                data-testid="model-status"
                className={cn(
                  "ml-auto",
                  status.tone === "active" ? "text-cherenkov-ink" : status.tone === "warn" ? "text-warn" : "text-fg-muted",
                )}
              >
                {status.label}
              </span>
            </>
          )}
        </div>
        {!collapsed && (
          <div className="flex gap-4 text-[12.5px]">
            <ExternalLink href="https://arxiv.org/abs/2608.04030">Paper</ExternalLink>
            <ExternalLink href={`https://huggingface.co/${MODEL.id}`}>Model card</ExternalLink>
          </div>
        )}
      </div>
    </div>
  );
}

function ThreadItem({
  thread,
  active,
  running,
  onSelect,
  onDelete,
}: {
  thread: Thread;
  active: boolean;
  running: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="group/thread relative">
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? "page" : undefined}
        title={thread.title}
        className={cn(
          "flex h-[34px] w-full items-center gap-2 rounded-[9px] pr-9 pl-3 text-left text-[13.5px] text-fg-muted transition-colors hover:bg-white/5 hover:text-fg",
          active && "bg-white/8 text-fg",
        )}
      >
        {running && <StatusDot tone="active" label="Generating" />}
        <span className="truncate">{thread.title}</span>
      </button>
      {!running && (
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete thread: ${thread.title}`}
          title="Delete thread"
          className="absolute top-1/2 right-1 grid size-7 -translate-y-1/2 place-items-center rounded-md text-fg-subtle opacity-0 transition-opacity group-focus-within/thread:opacity-100 group-hover/thread:opacity-100 hover:bg-white/8 hover:text-fg focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
        >
          <Trash2 aria-hidden strokeWidth={1.5} className="size-[15px]" />
        </button>
      )}
    </li>
  );
}

export function Brand() {
  return (
    <div className="flex items-center gap-[11px] text-[15px] font-semibold tracking-[-0.01em] whitespace-nowrap">
      <span aria-hidden className="relative size-3.5 flex-none">
        <span className="absolute inset-0 rounded-full border-[1.5px] border-fg" />
        <span className="absolute top-1/2 left-1/2 size-1 -translate-1/2 rounded-full bg-cherenkov shadow-[0_0_8px_var(--cherenkov)]" />
      </span>
      NuclearDiffusion
    </div>
  );
}

export function StatusDot({ tone, label }: { tone: ModelStatus["tone"]; label?: string }) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(
        "size-[7px] flex-none rounded-full",
        tone === "active" && "animate-pulse-soft bg-cherenkov",
        tone === "warn" && "bg-warn",
        tone === "ready" && "bg-[#d7d8da]",
      )}
    />
  );
}

export function IconButton({
  label,
  onClick,
  pressed,
  children,
  className,
}: {
  label: string;
  onClick?: () => void;
  pressed?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className={cn(
        "grid size-9 flex-none place-items-center rounded-[9px] text-fg-muted transition-colors hover:bg-white/6 hover:text-fg [&_svg]:size-5 [&_svg]:stroke-[1.5]",
        pressed && "bg-white/8 text-fg",
        className,
      )}
    >
      {children}
    </button>
  );
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="flex items-center gap-1">
      {children}
      <ArrowUpRight aria-hidden strokeWidth={1.5} className="size-3.5" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}
