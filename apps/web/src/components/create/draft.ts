import { INITIAL_DRAFT, type CreateDraft, type StepIndex } from "./validate";
import type { TokenImage } from "./image";

/** localStorage key of the autosaved wizard (§4.6). */
export const DRAFT_KEY = "hf-create-draft";
const VERSION = 1;

interface StoredImage {
  dataUrl: string;
  name: string;
  width: number | null;
  height: number | null;
  cropped: boolean;
}

interface StoredDraft {
  v: typeof VERSION;
  savedAt: number;
  step: StepIndex;
  visited: StepIndex;
  fields: Omit<CreateDraft, "image">;
  image: StoredImage | null;
  /** The image didn't fit in storage and has to be added again. */
  imageDropped: boolean;
}

export interface SavedWizard {
  draft: CreateDraft;
  step: StepIndex;
  visited: StepIndex;
}

export interface RestoredDraft extends SavedWizard {
  savedAt: number;
  imageDropped: boolean;
}

/** True when nothing worth resuming was entered (untouched defaults). */
export function isBlankDraft(d: CreateDraft): boolean {
  return (Object.keys(INITIAL_DRAFT) as (keyof CreateDraft)[]).every((k) => d[k] === INITIAL_DRAFT[k]);
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

/**
 * Saves the wizard. The image goes in as a data URL when it fits; if the browser's storage quota
 * refuses it, the text fields are still saved and the resume prompt asks for the image again.
 */
export async function saveDraft({ draft, step, visited }: SavedWizard) {
  const { image, ...fields } = draft;
  const base = { v: VERSION, savedAt: Math.floor(Date.now() / 1000), step, visited, fields } as const;
  const stored: StoredImage | null = image
    ? {
        dataUrl: await readDataUrl(image.file),
        name: image.file.name,
        width: image.width,
        height: image.height,
        cropped: image.cropped,
      }
    : null;
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...base, image: stored, imageDropped: false } satisfies StoredDraft));
  } catch {
    try {
      window.localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ ...base, image: null, imageDropped: !!stored } satisfies StoredDraft),
      );
    } catch {
      // Storage unavailable (private mode, quota): the wizard still works, it just won't resume.
    }
  }
}

export async function loadDraft(): Promise<RestoredDraft | null> {
  let stored: StoredDraft;
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    stored = JSON.parse(raw) as StoredDraft;
  } catch {
    return null;
  }
  if (stored?.v !== VERSION || typeof stored.fields !== "object") return null;
  let image: TokenImage | null = null;
  if (stored.image) {
    try {
      const blob = await (await fetch(stored.image.dataUrl)).blob();
      image = {
        file: new File([blob], stored.image.name, { type: blob.type }),
        width: stored.image.width,
        height: stored.image.height,
        cropped: stored.image.cropped,
      };
    } catch {
      image = null;
    }
  }
  return {
    savedAt: stored.savedAt,
    step: stored.step,
    visited: stored.visited,
    // Fields added in later versions of the wizard fall back to their defaults.
    draft: { ...INITIAL_DRAFT, ...stored.fields, image },
    imageDropped: stored.imageDropped || (!!stored.image && !image),
  };
}

export function clearDraft() {
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}
