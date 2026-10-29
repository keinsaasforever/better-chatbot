import { Skeleton } from "ui/skeleton";

interface EditShareableLoadingProps {
  title?: string;
  showGenerateButton?: boolean;
}

export function EditShareableLoading({
  title,
  showGenerateButton = false,
}: EditShareableLoadingProps) {
  return (
    <div className="h-full w-full relative">
      <div className="z-10 relative flex flex-col gap-4 px-8 pt-8 pb-14 max-w-3xl h-full mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 gap-2">
          {title ? (
            <h1 className="text-2xl font-bold">{title}</h1>
          ) : (
            <Skeleton className="h-8 w-32" />
          )}
          <div className="flex items-center gap-2">
            {showGenerateButton && <Skeleton className="h-10 w-10" />}
            <Skeleton className="h-10 w-10" />
          </div>
        </div>

        {/* Name and icon */}
        <div className="flex gap-4 mt-4">
          <div className="flex flex-col justify-between gap-2 flex-1">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-10 w-full" />
          </div>
          <Skeleton className="w-16 h-16 rounded-lg" />
        </div>

        {/* Description */}
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-10 w-full" />
        </div>

        {/* Settings */}
        <div className="mt-10">
          <Skeleton className="h-4 w-48" />
        </div>

        <div className="flex flex-col gap-6">
          {/* Role/Visibility */}
          <div className="flex gap-2 items-center">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-44" />
            <Skeleton className="h-4 w-16" />
          </div>

          {/* Instructions/Content */}
          <div className="flex gap-2 flex-col">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-48 w-full" />
          </div>

          {/* Tools/Additional settings */}
          <div className="flex gap-2 flex-col">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-12 w-full" />
          </div>
        </div>

        {/* Save button */}
        <div className="flex justify-end">
          <Skeleton className="h-10 w-20" />
        </div>
      </div>
    </div>
  );
}
