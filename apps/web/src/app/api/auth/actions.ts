"use server";

import { userRepository } from "lib/db/repository";

// Sign-up deliberately has no server action. It runs through
// `authClient.signUp.email` so the request reaches the Better Auth handler,
// where the Turnstile plugin's `onRequest` hook can verify the captcha — a
// server action calling `auth.api.signUpEmail` bypasses that middleware and
// would be an unprotected account-creation endpoint of its own.

export async function existsByEmailAction(email: string) {
  const exists = await userRepository.existsByEmail(email);
  return exists;
}
