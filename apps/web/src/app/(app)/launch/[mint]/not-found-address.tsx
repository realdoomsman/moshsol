"use client";

import { shortAddr } from "@holdfast/sdk";
import { useParams } from "next/navigation";

/** The id from the URL under the launch 404 (not-found boundaries get no params, so it's read client-side). */
export function NotFoundAddress() {
  const { mint } = useParams<{ mint: string }>();
  const label = mint ? decodeURIComponent(mint) : "";
  return label ? <p className="mono mt-4 truncate text-ink-2">{label.length > 48 ? shortAddr(label, 10) : label}</p> : null;
}
