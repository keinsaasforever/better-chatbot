"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "ui/tabs";
import { cn } from "lib/utils";

export type WorkspaceMode = "work" | "cockpit";

export function workspaceModeOf(pathname: string | null): WorkspaceMode {
  return pathname === "/cockpit" || pathname?.startsWith("/cockpit/")
    ? "cockpit"
    : "work";
}

const MODES: Array<{ mode: WorkspaceMode; href: string }> = [
  { mode: "work", href: "/" },
  { mode: "cockpit", href: "/cockpit" },
];

/**
 * Work | Cockpit pill. The shadcn Tabs primitive supplies the tablist
 * semantics and arrow-key roving focus; each trigger is a prefetched Link, so
 * activating a segment is a navigation and the active segment always follows
 * the URL.
 */
export function WorkspaceModeToggle({
  variant = "default",
  className,
}: {
  variant?: "default" | "cockpit";
  className?: string;
}) {
  const t = useTranslations("Layout.workspaceMode");
  const active = workspaceModeOf(usePathname());
  const cockpit = variant === "cockpit";

  return (
    <Tabs value={active} className={cn("items-center", className)}>
      <TabsList
        aria-label={t("label")}
        className={cn(
          "h-9 rounded-full p-1",
          cockpit ? "bg-[#101215] ring-1 ring-black" : "bg-muted",
        )}
      >
        {MODES.map(({ mode, href }) => (
          <TabsTrigger
            key={mode}
            value={mode}
            asChild
            className={cn(
              "h-7 rounded-full px-4 text-sm font-medium",
              cockpit &&
                "border-0 text-[#8592a0] hover:text-[#e8eef2] data-[state=active]:bg-[#22262c] data-[state=active]:text-[#e8eef2] dark:data-[state=active]:bg-[#22262c] dark:data-[state=active]:text-[#e8eef2] dark:text-[#8592a0]",
            )}
          >
            <Link
              href={href}
              prefetch
              aria-current={active === mode ? "page" : undefined}
            >
              {t(mode)}
            </Link>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
