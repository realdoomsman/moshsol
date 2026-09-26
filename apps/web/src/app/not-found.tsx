import { Compass, Rocket } from "lucide-react";
import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";
import { NotFoundPanel } from "@/components/ui/not-found-panel";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <NotFoundPanel
      icon={<Compass className="size-6" aria-hidden />}
      title="This page doesn't exist"
      actions={
        <>
          <ButtonLink href="/" variant="primary" size="lg">
            Explore launches
          </ButtonLink>
          <ButtonLink href="/create" variant="secondary" size="lg">
            <Rocket className="size-4" aria-hidden /> Create a launch
          </ButtonLink>
        </>
      }
    >
      The link may be broken or the page may have moved.
    </NotFoundPanel>
  );
}
