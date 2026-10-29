"use client";
import { fetcher } from "lib/utils";
import useSWR, { type SWRConfiguration } from "swr";

export type ReferralInvitee = {
  name: string | null;
  email: string | null;
  rewardApplied: boolean;
  createdAt: number;
};

export type ReferralSummary = {
  /** False when AUTUMN_REFERRAL_PROGRAM_ID is unset — the UI hides itself. */
  configured: boolean;
  code?: string | null;
  link?: string | null;
  rewardCredits?: number;
  referrals?: ReferralInvitee[];
};

export function useReferral(options: SWRConfiguration = {}) {
  const { data, error, isLoading, mutate } = useSWR<ReferralSummary>(
    "/api/referral",
    fetcher,
    {
      errorRetryCount: 0,
      revalidateOnFocus: false,
      ...options,
    },
  );

  return { referral: data, isLoading, error, mutate };
}
