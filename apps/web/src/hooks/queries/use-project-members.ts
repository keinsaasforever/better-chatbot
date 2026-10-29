"use client";
import useSWR, { SWRConfiguration } from "swr";
import { fetcher } from "lib/utils";

export type ProjectMemberRow = {
  id: string;
  userId: string;
  role: "owner" | "editor" | "viewer";
  createdAt: string;
  name: string | null;
  email: string | null;
  image: string | null;
};

export function useProjectMembers(
  projectId: string,
  options?: SWRConfiguration,
) {
  return useSWR<{ members: ProjectMemberRow[] }>(
    `/api/projects/${projectId}/members`,
    fetcher,
    { revalidateOnFocus: false, ...options },
  );
}
