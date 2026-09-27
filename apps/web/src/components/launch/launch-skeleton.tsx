import { Skeleton } from "../legacy/primitives";

/** Placeholder with the live launch page's geometry (header, chart, stats, tabs · trade rail). */
export function LaunchSkeleton() {
  return (
    <div aria-busy aria-label="Loading launch" className="pb-8">
      <div className="flex flex-col gap-5 pb-6 md:flex-row md:items-end md:justify-between">
        <div className="flex gap-4">
          <Skeleton className="size-[52px] rounded-2xl sm:size-16" />
          <div className="space-y-3 pt-1">
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-4 w-72 max-w-[60vw]" />
          </div>
        </div>
        <div className="flex items-end gap-4">
          <div className="space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-9 w-36" />
          </div>
          <Skeleton className="h-10 w-24 rounded-xl" />
        </div>
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="grid gap-5">
          <div className="card p-3 sm:p-4">
            <Skeleton className="h-10 w-72 max-w-full rounded-xl sm:h-9" />
            <Skeleton className="mt-3 h-[300px] w-full sm:h-[380px] lg:h-[420px]" />
          </div>
          <Skeleton className="h-[76px] w-full rounded-2xl" />
          <Skeleton className="hidden h-[420px] w-full rounded-2xl lg:block" />
        </div>
        <div className="grid gap-5">
          <Skeleton className="h-[470px] w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
