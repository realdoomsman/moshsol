"use client";

import { ImagePlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";
import { IMAGE_TYPES, RECOMMENDED_IMAGE_PX, type TokenImage } from "./image";

/** Object URL for a local file, revoked when it changes or unmounts. */
export function useObjectUrl(file: File | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

/**
 * Square token-art drop zone (§4.6 step 1): drag and drop or browse, shows the square crop that
 * will be minted, and the file facts (size, crop) underneath.
 */
export function ImageDrop({
  id,
  image,
  preview,
  busy,
  invalid,
  onFile,
  onClear,
}: {
  id: string;
  image: TokenImage | null;
  preview: string | null;
  busy: boolean;
  invalid: boolean;
  onFile: (file: File) => void;
  onClear: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const small =
    image?.width && image.height ? Math.min(image.width, image.height) < RECOMMENDED_IMAGE_PX : false;

  return (
    <div className="flex items-start gap-4">
      <button
        id={id}
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
        aria-busy={busy || undefined}
        aria-label={preview ? "Replace token image" : "Upload token image"}
        className={cn(
          "group relative grid size-28 shrink-0 place-items-center overflow-hidden rounded-md border transition-colors sm:size-32",
          preview ? "border-line" : "border-dashed",
          over
            ? "border-ink bg-sunken"
            : invalid
              ? "border-down bg-field"
              : preview
                ? "bg-sunken"
                : "border-line-2 bg-field hover:border-ink-3",
        )}
      >
        {preview ? (
          // Local object URL of the file about to be uploaded (already cropped to square).
          <img src={preview} alt="" className="size-full object-cover" />
        ) : (
          <span className="flex flex-col items-center gap-2 px-3 text-center text-ink-2 transition-colors group-hover:text-ink">
            <ImagePlus className="size-5" strokeWidth={1.5} aria-hidden />
            <span className="small">{busy ? "Reading…" : "Drop or browse"}</span>
          </span>
        )}
      </button>
      <div className="grid min-w-0 gap-1 pt-1">
        <p className="small text-ink-2">Square, at least {RECOMMENDED_IMAGE_PX} px. PNG, JPG, GIF, WebP or SVG up to 4 MB.</p>
        {image ? (
          <p className={cn("small num", small ? "text-warn" : "text-ink-3")}>
            {image.width && image.height ? `${image.width} × ${image.height} px` : "Vector image"}
            {image.cropped ? " · cropped to square" : ""}
            {small ? ` · looks soft below ${RECOMMENDED_IMAGE_PX} px` : ""}
          </p>
        ) : null}
        <div className="mt-1 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" busy={busy} onClick={() => input.current?.click()}>
            {preview ? "Replace" : "Choose image"}
          </Button>
          {preview ? (
            <Button size="sm" variant="ghost" onClick={onClear}>
              Remove
            </Button>
          ) : null}
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept={IMAGE_TYPES.join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
