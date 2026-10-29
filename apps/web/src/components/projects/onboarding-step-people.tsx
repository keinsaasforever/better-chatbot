"use client";

import { IS_CLOUD_EDITION } from "@/lib/edition";
import useSWR from "swr";
import { UserRound } from "lucide-react";
import { authClient } from "auth/client";
import { fetcher } from "lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "ui/avatar";
import { Checkbox } from "ui/checkbox";

type OrgMember = {
  id: string;
  userId: string;
  user: { name: string | null; email: string | null; image: string | null };
};

export function OnboardingStepPeople({
  memberUserIds,
  onChange,
}: {
  memberUserIds: string[];
  onChange: (memberUserIds: string[]) => void;
}) {
  const { data: activeOrg } = authClient.useActiveOrganization();
  const { data: session } = authClient.useSession();
  const { data, isLoading } = useSWR<{ members: OrgMember[] }>(
    IS_CLOUD_EDITION && activeOrg
      ? `/api/organization/${activeOrg.id}/members`
      : null,
    fetcher,
  );

  const candidates = (data?.members ?? []).filter(
    (member) => member.userId !== session?.user?.id,
  );

  const toggle = (userId: string) => {
    onChange(
      memberUserIds.includes(userId)
        ? memberUserIds.filter((id) => id !== userId)
        : [...memberUserIds, userId],
    );
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Add org members as collaborators on this project.
      </p>
      {isLoading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Loading organization members…
        </p>
      ) : candidates.length === 0 ? (
        <div className="flex items-center justify-center rounded-lg border border-dashed p-8">
          <div className="text-center">
            <UserRound className="mx-auto mb-3 size-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No other members in this organization yet.
            </p>
          </div>
        </div>
      ) : (
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {candidates.map((member) => (
            <label
              key={member.userId}
              className="flex cursor-pointer items-center gap-3 rounded-lg p-2 hover:bg-muted"
            >
              <Checkbox
                checked={memberUserIds.includes(member.userId)}
                onCheckedChange={() => toggle(member.userId)}
              />
              <Avatar className="size-7">
                <AvatarImage src={member.user.image ?? undefined} />
                <AvatarFallback className="text-[11px]">
                  {(member.user.name || member.user.email || "?")
                    .slice(0, 2)
                    .toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="text-sm">
                {member.user.name ?? member.user.email ?? member.userId}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
