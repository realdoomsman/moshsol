import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="grid gap-6" aria-busy>
      <div className="flex items-center gap-4">
        <Skeleton immediate className="size-12 rounded-full" />
        <div className="grid gap-2">
          <Skeleton immediate className="h-6 w-48" />
          <Skeleton immediate className="h-4 w-32" />
        </div>
      </div>
      <Skeleton immediate className="h-24 w-full rounded-md" />
      <Skeleton immediate className="h-64 w-full rounded-md" />
    </div>
  );
}
