import Link from "next/link";

export default function ExportError({ message }: { message: string }) {
  return (
    <div className="w-full h-screen flex items-center justify-center">
      <div className="flex flex-col gap-4">
        <div className="text-2xl font-bold flex items-center gap-4">
          {message}
        </div>
        <Link
          href="/"
          className="hover:underline text-sm text-muted-foreground text-center"
        >
          Go to home
        </Link>
      </div>
    </div>
  );
}
