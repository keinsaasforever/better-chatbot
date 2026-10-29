import { APIError, createAuthMiddleware } from "better-auth/api";
import { passwordSchema } from "lib/validations/password";

/**
 * Server-side password policy for email sign-up.
 *
 * This used to live only in the `signUpAction` server action, which meant a
 * direct POST to `/api/auth/sign-up/email` skipped it entirely. As a Better
 * Auth `before` hook it runs for the HTTP endpoint and for every `auth.api`
 * caller alike — unlike the captcha plugin, `hooks.before` is applied by
 * `toAuthEndpoints` rather than the router, so nothing routes around it.
 *
 * `ctx.path` is the endpoint path *without* the `/api/auth` base path.
 */
export const signUpPasswordPolicy = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== "/sign-up/email") return;
  const result = passwordSchema.safeParse(ctx.body?.password);
  if (!result.success) {
    throw new APIError("BAD_REQUEST", {
      message: result.error.issues.map((issue) => issue.message).join(" "),
    });
  }
});
