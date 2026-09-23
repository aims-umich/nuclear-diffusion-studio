import { cn } from "@/lib/utils";
import { MODEL } from "@/lib/contract";

export type ConnectionStatus = {
  label: string;
  tone: "neutral" | "active" | "warn";
};

const LINKS = [
  { label: "Paper", href: "https://arxiv.org/abs/2608.04030" },
  { label: "Model", href: `https://huggingface.co/${MODEL.id}` },
] as const;

export function SiteHeader({ status, mode }: { status: ConnectionStatus; mode: "mock" | "live" }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-5 border-b border-white/8 px-[clamp(16px,4vw,32px)] py-[19px]">
      <div className="flex items-center gap-3">
        <span aria-hidden className="relative size-3.5">
          <span className="absolute inset-0 rounded-full border-[1.5px] border-fg" />
          <span className="absolute top-1/2 left-1/2 size-[3.5px] -translate-1/2 rounded-full bg-fg" />
        </span>
        <h1 className="text-base font-semibold tracking-[-0.01em]">NuclearDiffusion</h1>
        <span className="border-l border-white/10 pl-[13px] font-mono text-[11px] font-medium tracking-[0.02em] text-fg-subtle">
          {MODEL.label} · {MODEL.precision}
          {mode === "mock" && (
            <span title="Images come from the mock inference layer, not the model">
              {" "}
              · mock
            </span>
          )}
        </span>
      </div>

      <nav aria-label="Project" className="flex items-center gap-6">
        {LINKS.map((link) => (
          <a
            key={link.label}
            href={link.href}
            target="_blank"
            rel="noreferrer"
            className="text-[13px] font-medium text-fg-muted transition-colors hover:text-fg"
          >
            {link.label}
          </a>
        ))}
        <span
          data-testid="connection-status"
          className={cn(
            "flex items-center gap-[7px] font-mono text-[11px] font-medium",
            status.tone === "warn" ? "text-warn" : "text-fg-muted",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "size-1.5 rounded-full",
              status.tone === "warn" && "bg-warn",
              status.tone === "active" && "bg-[#d7d8da]",
              status.tone === "neutral" && "bg-fg-subtle",
            )}
          />
          {status.label}
        </span>
      </nav>
    </header>
  );
}
