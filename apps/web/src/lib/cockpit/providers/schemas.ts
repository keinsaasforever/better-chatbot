import { z } from "zod";
import type { CockpitProvider } from "../types";

/**
 * Connection config per provider. Client-safe (no server imports): the
 * CONNECT dialog renders its form from `PROVIDER_FIELDS` and the API
 * validates with `PROVIDER_CONFIG_SCHEMAS`.
 */

const url = z.string().trim().url().max(500);
const secret = z.string().trim().min(1).max(10_000);

export const websiteConfigSchema = z.object({
  supabaseUrl: url,
  supabaseSecretKey: secret,
  rangeDays: z.coerce.number().int().min(1).max(90).default(30),
});

export const vercelProjectSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{1,32}$/),
  projectId: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(32),
});

export const vercelConfigSchema = z.object({
  token: secret,
  teamId: z.string().trim().max(100).optional().or(z.literal("")),
  projects: z.array(vercelProjectSchema).min(1).max(6),
});

export const stripeConfigSchema = z.object({
  restrictedKey: z
    .string()
    .trim()
    .regex(
      /^rk_(live|test)_[A-Za-z0-9]+$/,
      "restricted key (rk_live_ or rk_test_)",
    ),
});

export const revolutConfigSchema = z.object({
  clientId: z.string().trim().min(1).max(200),
  privateKeyPem: z
    .string()
    .trim()
    .min(1)
    .max(10_000)
    .refine((v) => v.includes("PRIVATE KEY"), "PEM private key"),
  refreshToken: secret,
  sandbox: z.coerce.boolean().default(false),
  /** Domain of the redirect URI registered in Revolut (JWT `iss`). */
  issuer: z.string().trim().max(200).optional().or(z.literal("")),
  largeTransactionThreshold: z.coerce.number().min(0).default(5000),
});

export const superlogConfigSchema = z.object({
  mcpUrl: url,
  token: secret,
});

export const SEO_DEFAULT_MCP_URL = {
  openseo: "https://app.openseo.so/mcp",
  dataforseo: "https://mcp.dataforseo.com/v3/mcp",
} as const;

export const seoConfigSchema = z
  .object({
    kind: z.enum(["openseo", "dataforseo"]),
    /**
     * An MCP server connected in Navigator (`mcp_server`), whose OAuth
     * session Navigator keeps fresh. Required for OpenSEO, which only signs
     * in with OAuth; optional for DataForSEO.
     */
    mcpServerId: z.string().uuid().optional().or(z.literal("")),
    mcpUrl: url.optional().or(z.literal("")),
    login: z.string().trim().max(200).optional().or(z.literal("")),
    password: z.string().trim().max(1000).optional().or(z.literal("")),
    domain: z
      .string()
      .trim()
      .toLowerCase()
      .regex(
        /^(?!https?:)[a-z0-9.-]+\.[a-z]{2,}$/,
        "bare domain, e.g. example.com",
      ),
    /** Search market, e.g. "Germany" + "de". Sent only if a tool asks. */
    locationName: z.string().trim().max(100).optional().or(z.literal("")),
    languageCode: z.string().trim().max(10).optional().or(z.literal("")),
  })
  .refine(
    (c) =>
      c.kind === "dataforseo" && !c.mcpServerId
        ? Boolean(c.login && c.password)
        : true,
    { path: ["login"], message: "login and password required for DataForSEO" },
  );

export type WebsiteConfig = z.infer<typeof websiteConfigSchema>;
export type VercelConfig = z.infer<typeof vercelConfigSchema>;
export type StripeConfig = z.infer<typeof stripeConfigSchema>;
export type RevolutConfig = z.infer<typeof revolutConfigSchema>;
export type SuperlogConfig = z.infer<typeof superlogConfigSchema>;
export type SeoConfig = z.infer<typeof seoConfigSchema>;

export const PROVIDER_CONFIG_SCHEMAS = {
  website: websiteConfigSchema,
  vercel: vercelConfigSchema,
  stripe: stripeConfigSchema,
  revolut: revolutConfigSchema,
  superlog: superlogConfigSchema,
  seo: seoConfigSchema,
} satisfies Record<CockpitProvider, z.ZodType>;

export type FieldType =
  | "text"
  | "secret"
  | "secretTextarea"
  | "number"
  | "boolean"
  | "select"
  | "projects"
  | "mcpServer";

export type ProviderField = {
  name: string;
  type: FieldType;
  required?: boolean;
  options?: readonly string[];
  /** Accepted on save but never stored (e.g. a one-time auth code). */
  transient?: boolean;
};

export const PROVIDER_FIELDS: Record<CockpitProvider, ProviderField[]> = {
  website: [
    { name: "supabaseUrl", type: "text", required: true },
    { name: "supabaseSecretKey", type: "secret", required: true },
    { name: "rangeDays", type: "number" },
  ],
  vercel: [
    { name: "token", type: "secret", required: true },
    { name: "teamId", type: "text" },
    { name: "projects", type: "projects", required: true },
  ],
  stripe: [{ name: "restrictedKey", type: "secret", required: true }],
  revolut: [
    { name: "clientId", type: "text", required: true },
    { name: "privateKeyPem", type: "secretTextarea", required: true },
    { name: "authorizationCode", type: "secret", transient: true },
    { name: "refreshToken", type: "secret" },
    { name: "issuer", type: "text" },
    { name: "sandbox", type: "boolean" },
    { name: "largeTransactionThreshold", type: "number" },
  ],
  superlog: [
    { name: "mcpUrl", type: "text", required: true },
    { name: "token", type: "secret", required: true },
  ],
  seo: [
    {
      name: "kind",
      type: "select",
      required: true,
      options: ["openseo", "dataforseo"],
    },
    { name: "domain", type: "text", required: true },
    { name: "mcpServerId", type: "mcpServer" },
    { name: "mcpUrl", type: "text" },
    { name: "login", type: "text" },
    { name: "password", type: "secret" },
    { name: "locationName", type: "text" },
    { name: "languageCode", type: "text" },
  ],
};

export function isSecretField(field: ProviderField): boolean {
  return field.type === "secret" || field.type === "secretTextarea";
}

/**
 * "NAVIGATOR = prj_123" lines → Vercel project entries (form helper). A bare
 * line is a project id or name and doubles as the label.
 */
export function parseProjectLines(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const eq = line.indexOf("=");
      const label = (eq < 0 ? line : line.slice(0, eq)).trim();
      const projectId = (eq < 0 ? line : line.slice(eq + 1)).trim();
      return {
        key:
          label
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 32) || "project",
        label: label.slice(0, 32),
        projectId,
      };
    });
}

export function formatProjectLines(
  projects: Array<{ label: string; projectId: string }> | undefined,
): string {
  return (projects ?? []).map((p) => `${p.label} = ${p.projectId}`).join("\n");
}
