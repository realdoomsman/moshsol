import { Skeleton } from "./primitives";

export function PortfolioSkeleton() {
  return (
    <div aria-busy aria-label="Loading portfolio" className="pb-8">
      <div className="mb-8 space-y-3 pt-4">
        <Skeleton className="h-9 w-64 max-w-full sm:h-10" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-5">
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    </div>
  );
}
