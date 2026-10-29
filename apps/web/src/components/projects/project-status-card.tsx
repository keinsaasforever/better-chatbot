"use client";

import type { ProjectOverviewResponse } from "@/hooks/queries/use-project-overview";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Badge } from "ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "ui/card";
import { Skeleton } from "ui/skeleton";

const HEALTH_STYLES: Record<string, string> = {
  green: "border-emerald-500/40 text-emerald-600",
  yellow: "border-amber-500/40 text-amber-600",
  red: "border-red-500/40 text-red-600",
  unknown: "border-border text-muted-foreground",
};

export function ProjectStatusCard({
  projectId,
  status,
  connectorIssues,
  isLoading,
}: {
  projectId: string;
  status: ProjectOverviewResponse["status"] | undefined;
  connectorIssues: ProjectOverviewResponse["connectorIssues"] | undefined;
  isLoading: boolean;
}) {
  const t = useTranslations("Projects");
  const health = status?.health ?? "unknown";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 py-4">
        <CardTitle className="text-base">{t("statusTitle")}</CardTitle>
        <Badge
          variant="outline"
          className={`text-[10px] px-1.5 py-0 ${HEALTH_STYLES[health] ?? HEALTH_STYLES.unknown}`}
        >
          {t(`health.${health}`)}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {isLoading && !status ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : status ? (
          <>
            {status.summary && <p>{status.summary}</p>}
            {status.progressPct !== null && (
              <div>
                <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                  <span>{t("progress")}</span>
                  <span>{Math.round(status.progressPct)}%</span>
                </div>
                <div className="h-2 rounded-full bg-secondary">
                  <div
                    className="h-2 rounded-full bg-primary"
                    style={{
                      width: `${Math.min(100, Math.max(0, status.progressPct))}%`,
                    }}
                  />
                </div>
              </div>
            )}
            {status.blockers.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  {t("blockers")}
                </p>
                <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                  {status.blockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          <p className="text-muted-foreground">{t("noStatus")}</p>
        )}

        {connectorIssues && connectorIssues.length > 0 && (
          <ul className="space-y-1">
            {connectorIssues.map((issue) => (
              <li
                key={issue.id}
                className="flex items-center gap-2 text-xs text-amber-600"
              >
                <AlertTriangle className="size-3.5 shrink-0" />
                <span className="flex-1 truncate">
                  {t("connectorIssue", { name: issue.displayName })}
                </span>
                <Link
                  href={`/projects/${projectId}?tab=brain`}
                  className="underline underline-offset-2"
                >
                  {t("reconnect")}
                </Link>
              </li>
            ))}
          </ul>
        )}

        {status && (
          <p className="text-[11px] text-muted-foreground">
            {t("updatedAt", {
              time: formatDistanceToNow(new Date(status.generatedAt), {
                addSuffix: true,
              }),
            })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
