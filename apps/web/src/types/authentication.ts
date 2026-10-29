import { z } from "zod";
import { envBooleanSchema } from "./util";

export const SocialAuthenticationProviderSchema = z.enum([
  "github",
  "google",
  "microsoft",
]);

export type SocialAuthenticationProvider = z.infer<
  typeof SocialAuthenticationProviderSchema
>;

export const GitHubConfigSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  disableSignUp: z.boolean().optional(),
});

export const GoogleConfigSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  disableSignUp: z.boolean().optional(),
  prompt: z.literal("select_account").optional(),
});

export const MicrosoftConfigSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  tenantId: z.string().default("common"),
  disableSignUp: z.boolean().optional(),
  prompt: z.literal("select_account").optional(),
});

export const SocialAuthenticationConfigSchema = z.object({
  github: GitHubConfigSchema.optional(),
  google: GoogleConfigSchema.optional(),
  microsoft: MicrosoftConfigSchema.optional(),
});

export const AuthConfigSchema = z.object({
  emailAndPasswordEnabled: envBooleanSchema.default(true),
  signUpEnabled: envBooleanSchema.default(true),
  socialAuthenticationProviders: SocialAuthenticationConfigSchema,
});

export type GitHubConfig = z.infer<typeof GitHubConfigSchema>;
export type GoogleConfig = z.infer<typeof GoogleConfigSchema>;
export type MicrosoftConfig = z.infer<typeof MicrosoftConfigSchema>;
export type SocialAuthenticationConfig = z.infer<
  typeof SocialAuthenticationConfigSchema
>;

export type AuthConfig = z.infer<typeof AuthConfigSchema>;
