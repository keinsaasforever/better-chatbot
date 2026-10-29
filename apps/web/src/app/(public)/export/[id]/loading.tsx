import { Skeleton } from "ui/skeleton";

export default function ExportLoading() {
  return (
    <div className="w-full mx-auto max-w-3xl flex flex-col gap-10 py-8 md:py-14 px-4">
      <Skeleton className="h-14 w-4/5 ml-auto" />
      <Skeleton className="h-64 w-4/5 mr-auto" />
      <Skeleton className="h-28 w-3/4 ml-auto" />
      <Skeleton className="h-36 w-full mr-auto" />
    </div>
  );
}
