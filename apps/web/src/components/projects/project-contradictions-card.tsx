"use client";

import { fetcher } from "@/lib/utils";
import { AlertTriangle, Check, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Button } from "ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "ui/card";

type FactRef = {
  value: string;
  sourceScope: string;
  observedAt: string;
} | null;

type Contradiction = {
  id: string;
  pageId: string;
  pageTitle: string;
  factKey: string;
  explanation: string | null;
  a: FactRef;
  b: FactRef;
  createdAt: string;
};

export function ProjectContradictionsCard({
  projectId,
  canEdit,
}: {
  projectId: string;
  canEdit: boolean;
}) {
  const t = useTranslations("Projects.contradictions");
  const key = `/api/projects/${projectId}/brain/contradictions`;
  const { data, mutate } = useSWR<{ contradictions: Contradiction[] }>(
    key,
    fetcher,
    { revalidateOnFocus: false },
  );
  const [busyId, setBusyId] = useState<string | null>(null);

  const update = async (id: string, status: "resolved" | "dismissed") => {
    setBusyId(id);
    try {
      const response = await fetch(`${key}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error();
      await mutate();
    } catch {
      toast.error(t("updateFailed"));
    } finally {
      setBusyId(null);
    }
  };

  const items = data?.contradictions ?? [];

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-amber-600" />
          {t("title")}
        </CardTitle>
        <span className="text-xs text-muted-foreground">{items.length}</span>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {items.length === 0 ? (
          <p className="text-muted-foreground">{t("empty")}</p>
        ) : (
          items.map((item) => (
            <div key={item.id} className="rounded-lg border p-3">
              <p className="font-medium">
                {item.pageTitle}{" "}
                <span className="text-xs text-muted-foreground">
                  · {item.factKey}
                </span>
              </p>
              <ul className="mt-1 space-y-0.5 text-muted-foreground">
                {[item.a, item.b].map((fact, index) =>
                  fact ? (
                    <li key={`${item.id}-${index}`}>
                      <span className="text-foreground">{fact.value}</span>{" "}
                      <span className="text-[11px]">
                        ({fact.sourceScope.split(":")[0]},{" "}
                        {new Date(fact.observedAt).toLocaleDateString()})
                      </span>
                    </li>
                  ) : null,
                )}
              </ul>
              {item.explanation && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.explanation}
                </p>
              )}
              {canEdit && (
                <div className="mt-2 flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={busyId === item.id}
                    onClick={() => update(item.id, "resolved")}
                  >
                    <Check className="mr-1 size-3" />
                    {t("resolve")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={busyId === item.id}
                    onClick={() => update(item.id, "dismissed")}
                  >
                    <X className="mr-1 size-3" />
                    {t("dismiss")}
                  </Button>
                </div>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
