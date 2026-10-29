"use client";

import { useSkills } from "@/hooks/queries/use-skills";
import type { SkillSearchResult } from "app-types/skill";
import type { SkillSummary } from "app-types/skill";
import { fetcher } from "lib/utils";
import { Check, Download, Loader, Search, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { Button } from "ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "ui/dialog";
import { Input } from "ui/input";

function SkillResultCard({
  skill,
  saved,
  onSave,
  saving,
}: {
  skill: SkillSearchResult;
  saved: boolean;
  onSave: (skill: SkillSearchResult) => void;
  saving: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
        <Sparkles className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{skill.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {skill.source} · {skill.installs.toLocaleString()} installs
        </p>
      </div>
      {saved ? (
        <Button variant="ghost" size="sm" disabled className="gap-1">
          <Check className="size-3.5" /> Saved
        </Button>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          className="gap-1"
          disabled={saving}
          onClick={() => onSave(skill)}
        >
          {saving ? (
            <Loader className="size-3.5 animate-spin" />
          ) : (
            <Download className="size-3.5" />
          )}
          Save
        </Button>
      )}
    </div>
  );
}

export function SkillsSearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { mutate } = useSWRConfig();
  const { skills: savedSkills } = useSkills();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [results, setResults] = useState<SkillSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [unreachable, setUnreachable] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const savedSources = new Set(
    savedSkills.map((s: SkillSummary) => `${s.source}/${s.slug}`),
  );

  const runSearch = useCallback(async (query: string) => {
    setIsLoading(true);
    setUnreachable(false);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      const data = (await fetcher(
        `/api/skills/search?${params.toString()}`,
      )) as {
        skills: SkillSearchResult[];
        unreachable?: boolean;
      };
      setResults(data.skills ?? []);
      setUnreachable(Boolean(data.unreachable));
    } catch {
      setResults([]);
      setUnreachable(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const onSearchChange = (value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(value), 350);
  };

  // Open the dialog on the leaderboard (blank query = most-installed), then
  // re-query as the debounced search changes.
  useEffect(() => {
    if (!open) return;
    runSearch(debouncedSearch);
  }, [open, debouncedSearch, runSearch]);

  const onSave = useCallback(
    async (skill: SkillSearchResult) => {
      setSavingId(skill.id);
      try {
        const res = await fetch("/api/skills", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: skill.name,
            slug: skill.id,
            source: skill.source,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? "Failed to save skill");
        }
        // Refresh every saved-skills list view.
        mutate(
          (key) => typeof key === "string" && key.startsWith("/api/skills?"),
        );
      } catch (error: any) {
        toast.error(error?.message ?? "Failed to save skill");
      } finally {
        setSavingId(null);
      }
    },
    [mutate],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4" /> Add a skill
          </DialogTitle>
          <DialogDescription>
            Search the Vercel skills library and save skills to use them in chat
            or on your agents.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search skills…"
            className="pl-9"
          />
        </div>

        <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto py-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader className="size-4 animate-spin" />
            </div>
          ) : unreachable ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              The skills library is unreachable right now. Please try again.
            </p>
          ) : results.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {search.trim()
                ? `No skills found for "${search}"`
                : "No skills found."}
            </p>
          ) : (
            <>
              {!search.trim() && (
                <p className="px-1 text-xs font-medium text-muted-foreground">
                  Most popular
                </p>
              )}
              {results.map((skill) => (
                <SkillResultCard
                  key={`${skill.source}/${skill.id}`}
                  skill={skill}
                  saved={savedSources.has(`${skill.source}/${skill.id}`)}
                  saving={savingId === skill.id}
                  onSave={onSave}
                />
              ))}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
