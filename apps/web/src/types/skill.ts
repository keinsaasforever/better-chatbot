import z from "zod";
import { VisibilitySchema } from "./util";

export type SkillIcon = {
  type: "emoji";
  value: string;
  style?: Record<string, string>;
};

const SkillIconSchema = z.object({
  type: z.literal("emoji"),
  value: z.string(),
  style: z.record(z.string(), z.string()).optional(),
});

// A skills.sh `owner/repo` identifier. Validated so the search proxy and the
// SKILL.md content fetch never take an arbitrary user-supplied URL.
export const SkillSourceSchema = z
  .string()
  .regex(/^[\w.-]+\/[\w.-]+$/, "source must be owner/repo");

export const SkillCreateSchema = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    slug: z.string().min(1).max(200),
    source: SkillSourceSchema,
    // The fetched SKILL.md instruction body (frontmatter stripped, size-capped).
    content: z.string().min(1),
    icon: SkillIconSchema.optional(),
    userId: z.string(),
    visibility: VisibilitySchema.optional().default("private"),
  })
  .strip();

export const SkillUpdateSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    icon: SkillIconSchema.optional(),
    visibility: VisibilitySchema.optional(),
  })
  .strip();

export const SkillQuerySchema = z.object({
  type: z.enum(["all", "mine", "shared"]).default("all"),
  limit: z.coerce.number().min(1).max(100).default(50),
});

// Body accepted by POST /api/skills — the client sends the registry hit, the
// server resolves + fetches the SKILL.md content before inserting.
export const SkillSaveSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  slug: z.string().min(1).max(200),
  source: SkillSourceSchema,
  icon: SkillIconSchema.optional(),
  visibility: VisibilitySchema.optional(),
});

export type SkillVisibility = z.infer<typeof VisibilitySchema>;

export type SkillSummary = {
  id: string;
  name: string;
  description?: string;
  slug: string;
  source: string;
  icon?: SkillIcon;
  userId: string;
  visibility: SkillVisibility;
  createdAt: Date;
  updatedAt: Date;
  userName?: string;
  userAvatar?: string;
};

export type Skill = SkillSummary & {
  content: string;
};

// A single result from the skills.sh registry (`/api/search`).
export type SkillSearchResult = {
  id: string;
  name: string;
  source: string;
  installs: number;
};

export type SkillRepository = {
  insertSkill(
    skill: z.infer<typeof SkillCreateSchema> & {
      organizationId?: string | null;
    },
  ): Promise<Skill>;

  // activeOrganizationId gates the shared (public/readonly) branch: shared
  // skills are only visible when they belong to the caller's active org.
  // Null/undefined => owner-only.
  selectSkillById(
    id: string,
    userId: string,
    activeOrganizationId?: string | null,
  ): Promise<Skill | null>;

  selectSkillsByUserId(userId: string): Promise<SkillSummary[]>;

  updateSkill(
    id: string,
    userId: string,
    skill: z.infer<typeof SkillUpdateSchema>,
  ): Promise<Skill>;

  deleteSkill(id: string, userId: string): Promise<void>;

  selectSkills(
    currentUserId: string,
    filters?: ("all" | "mine" | "shared")[],
    limit?: number,
    activeOrganizationId?: string | null,
  ): Promise<SkillSummary[]>;

  checkAccess(
    skillId: string,
    userId: string,
    destructive?: boolean,
    activeOrganizationId?: string | null,
  ): Promise<boolean>;
};
