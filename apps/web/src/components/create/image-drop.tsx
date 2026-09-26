"use client";

import { ImagePlus, X } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "../ui/cn";

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"];
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export function ImageDrop({
  preview,
  onFile,
  onClear,
  invalid,
}: {
  preview: string | null;
  onFile: (file: File) => void;
  onClear: () => void;
  invalid?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const file = e.dataTransfer.files[0];
          if (file) onFile(file);
        }}
        aria-invalid={invalid || undefined}
        aria-label={preview ? "Replace token image" : "Upload token image"}
        className={cn(
          "group relative grid size-32 place-items-center overflow-hidden rounded-2xl border border-dashed transition sm:size-36",
          over
            ? "border-lime bg-lime/10"
            : invalid
              ? "border-down/60 bg-down/5"
              : "border-line-strong bg-black/30 hover:border-lime/50 hover:bg-white/[0.03]",
        )}
      >
        {preview ? (
          <>
            {/* Local object URL preview of the file about to be uploaded. */}
            <img src={preview} alt="Token image preview" className="size-full object-cover" />
            <span className="absolute inset-0 grid place-items-center bg-black/60 text-xs font-semibold opacity-0 transition group-hover:opacity-100">
              Replace
            </span>
          </>
        ) : (
          <span className="flex flex-col items-center gap-2 px-3 text-center">
            <ImagePlus className="size-6 text-muted transition group-hover:text-lime" aria-hidden />
            <span className="text-xs font-medium text-muted">Drop image or click</span>
            <span className="text-[10.5px] text-dim">PNG, JPG, GIF, WEBP, SVG · 4 MB</span>
          </span>
        )}
      </button>
      {preview ? (
        <button
          type="button"
          onClick={onClear}
          aria-label="Remove image"
          className="absolute -top-2 -right-2 grid size-7 place-items-center rounded-full border border-line-strong bg-panel text-muted shadow-lg transition hover:text-ink"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      ) : null}
      <input
        ref={input}
        type="file"
        accept={IMAGE_TYPES.join(",")}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
