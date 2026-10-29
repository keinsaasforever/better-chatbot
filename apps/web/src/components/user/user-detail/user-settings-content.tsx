"use client";

import type { BasicUserWithLastLogin } from "app-types/user";
import { fetcher } from "lib/utils";
import useSWR from "swr";
import { UserDetail } from "./user-detail";
import { UserDetailContentSkeleton } from "./user-detail-content-skeleton";

type SettingsContext = {
  currentUserId: string;
  user: BasicUserWithLastLogin;
  userAccountInfo: { hasPassword: boolean; oauthProviders: string[] };
};

/**
 * Client-side self-view settings content. Fetches user and accounts in a single
 * request the first time it mounts (which only happens when the settings drawer
 * opens), replacing the layout's eager per-page-load server render.
 *
 * Usage deliberately lives on `/usage` only. It used to be rendered here as
 * well, which meant the same numbers in two places and a 30-day aggregation on
 * every drawer open.
 */
export function UserSettingsContent({
  view = "user",
}: {
  view?: "admin" | "user";
}) {
  const { data } = useSWR<SettingsContext>(
    "/api/user/settings-context",
    fetcher,
  );

  if (!data?.user) {
    return <UserDetailContentSkeleton />;
  }

  return (
    <UserDetail
      view={view}
      user={data.user}
      currentUserId={data.currentUserId}
      userAccountInfo={data.userAccountInfo}
    />
  );
}
