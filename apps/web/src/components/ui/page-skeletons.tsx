import { LaunchCardSkeleton } from "../explore/launch-card";
import { Skeleton } from "./primitives";

function Heading({ wide }: { wide?: boolean }) {
  return (
    <div className="mb-8 space-y-3 pt-4">
      <Skeleton className="h-9 w-64 max-w-full sm:h-10" />
      <Skeleton className={wide ? "h-4 w-[36rem] max-w-full" : "h-4 w-80 max-w-full"} />
    </div>
  );
}

export function ExploreSkeleton() {
  return (
    <div aria-busy aria-label="Loading launches">
      <div className="grid items-center gap-10 pt-8 pb-10 lg:grid-cols-[1.15fr_1fr] lg:gap-14 lg:pt-14 lg:pb-14">
        <div className="space-y-5">
          <Skeleton className="h-7 w-64 rounded-full" />
          <Skeleton className="h-12 w-full max-w-lg sm:h-16" />
          <Skeleton className="h-12 w-4/5 max-w-md sm:h-16" />
          <Skeleton className="h-5 w-full max-w-xl" />
          <div className="flex gap-3 pt-3">
            <Skeleton className="h-12 w-40 rounded-xl" />
            <Skeleton className="h-12 w-36 rounded-xl" />
          </div>
        </div>
        <Skeleton className="h-[360px] w-full rounded-[22px]" />
      </div>
      <Skeleton className="h-[92px] w-full rounded-2xl" />
      <div className="mt-12 space-y-3">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <Skeleton className="mt-5 h-11 w-80 max-w-full rounded-xl" />
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <LaunchCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

export function CreateSkeleton() {
  return (
    <div aria-busy aria-label="Loading" className="pb-8">
      <Heading wide />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_440px]">
        <div className="grid gap-5">
          <Skeleton className="h-[330px] w-full rounded-2xl" />
          <Skeleton className="h-[150px] w-full rounded-2xl" />
          <Skeleton className="h-[240px] w-full rounded-2xl" />
        </div>
        <div className="grid gap-5">
          <Skeleton className="h-[200px] w-full rounded-2xl" />
          <Skeleton className="h-[320px] w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}

export function PortfolioSkeleton() {
  return (
    <div aria-busy aria-label="Loading portfolio" className="pb-8">
      <Heading />
      <div className="grid gap-5">
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    </div>
  );
}

export function AgentsSkeleton() {
  return (
    <div aria-busy aria-label="Loading agents" className="pb-8">
      <Heading wide />
      <Skeleton className="mb-4 h-6 w-72" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-44 rounded-2xl" />
        ))}
      </div>
      <div className="mt-10 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

export function HowSkeleton() {
  return (
    <div aria-busy aria-label="Loading" className="pb-8">
      <div className="flex flex-col items-center gap-4 pt-6">
        <Skeleton className="h-12 w-full max-w-2xl sm:h-16" />
        <Skeleton className="h-12 w-3/4 max-w-xl sm:h-16" />
        <Skeleton className="mt-2 h-5 w-full max-w-xl" />
      </div>
      <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-48 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
