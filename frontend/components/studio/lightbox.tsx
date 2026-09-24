"use client";

import Image from "next/image";
import { ChevronLeft, ChevronRight, Copy, Download, X } from "lucide-react";
import { Dialog } from "radix-ui";
import type { GeneratedImage } from "@/lib/contract";
import type { Turn } from "@/lib/studio-state";

type LightboxProps = {
  turn: Turn | null;
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  onDownload: (image: GeneratedImage) => void;
  onCopySeed: (image: GeneratedImage) => void;
};

/** Full-size view of one image, with arrow keys stepping through the rest of its batch. */
export function Lightbox({ turn, index, onIndexChange, onClose, onDownload, onCopySeed }: LightboxProps) {
  const image = turn?.images[index];
  const params = turn?.params;
  const count = turn?.images.length ?? 0;
  const step = (delta: number) => onIndexChange((index + delta + count) % count);

  return (
    <Dialog.Root open={Boolean(image)} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/92 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          onKeyDown={(event) => {
            if (count < 2) return;
            if (event.key === "ArrowRight") step(1);
            if (event.key === "ArrowLeft") step(-1);
          }}
          className="fixed inset-0 z-50 flex flex-col outline-none"
        >
          {image && turn && params && (
            <>
              <div className="flex h-14 flex-none items-center gap-2 px-4">
                <Dialog.Title className="min-w-0 flex-1 truncate text-sm text-fg-soft">{turn.request.prompt}</Dialog.Title>
                <LightboxButton label="Download" onClick={() => onDownload(image)}>
                  <Download />
                </LightboxButton>
                <LightboxButton label="Copy seed" onClick={() => onCopySeed(image)}>
                  <Copy />
                </LightboxButton>
                <Dialog.Close asChild>
                  <LightboxButton label="Close">
                    <X />
                  </LightboxButton>
                </Dialog.Close>
              </div>
              <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-4 nav:px-16">
                <Image
                  src={image.image}
                  alt={`Generated image: ${turn.request.prompt}`}
                  width={params.width}
                  height={params.height}
                  unoptimized
                  className="h-auto max-h-full w-auto max-w-full rounded-lg object-contain"
                />
                {count > 1 && (
                  <>
                    <LightboxButton label="Previous image" onClick={() => step(-1)} className="absolute top-1/2 left-3 -translate-y-1/2">
                      <ChevronLeft />
                    </LightboxButton>
                    <LightboxButton label="Next image" onClick={() => step(1)} className="absolute top-1/2 right-3 -translate-y-1/2">
                      <ChevronRight />
                    </LightboxButton>
                  </>
                )}
              </div>
              <div className="flex flex-none flex-wrap justify-center gap-x-4 gap-y-1 pb-5 font-mono text-xs text-fg-muted">
                <span>seed {image.seed}</span>
                <span>
                  {params.width}×{params.height}
                </span>
                {count > 1 && (
                  <span>
                    {index + 1} of {count}
                  </span>
                )}
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function LightboxButton({
  label,
  onClick,
  className,
  children,
  ...rest
}: {
  label: string;
  onClick?: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`grid size-10 flex-none place-items-center rounded-full border border-white/12 bg-black/60 text-fg transition-colors hover:bg-white/10 [&_svg]:size-5 [&_svg]:stroke-[1.5] ${className ?? ""}`}
      {...rest}
    >
      {children}
    </button>
  );
}
