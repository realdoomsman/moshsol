import { SearchX } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/primitives";

export default function NotFound() {
  return (
    <Card className="mx-auto mt-10 max-w-xl">
      <EmptyState
        icon={<SearchX className="size-5" aria-hidden />}
        title="Page not found"
        action={
          <ButtonLink href="/" variant="primary">
            Explore launches
          </ButtonLink>
        }
      >
        That address isn&apos;t a page or a valid mint.
      </EmptyState>
    </Card>
  );
}
