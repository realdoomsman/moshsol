import type { Metadata } from "next";
import { NOT_FOUND_FRAME, NotFoundBody } from "@/components/shell/not-found-body";

export const metadata: Metadata = { title: "Page not found" };

/** `/docs/<unknown>`: the marketing layout already renders the shell, so only the body goes here. */
export default function DocNotFound() {
  return (
    <div className={NOT_FOUND_FRAME}>
      <NotFoundBody title="This doc doesn’t exist." primary={{ href: "/docs", label: "All docs" }} />
    </div>
  );
}
