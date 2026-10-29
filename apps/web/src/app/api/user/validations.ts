import { z } from "zod";
import { USER_ROLES, UserRoleNames } from "app-types/roles";

import { ActionState } from "lib/action-utils";
import { BasicUserWithLastLogin } from "app-types/user";
import { passwordSchema } from "lib/validations/password";

export const UpdateUserRoleSchema = z.object({
  userId: z.string().uuid("Invalid user ID"),
  role: z
    .enum(Object.values(USER_ROLES) as [UserRoleNames, ...UserRoleNames[]])
    .optional(),
});

export const UpdateUserPasswordError = {
  PASSWORD_MISMATCH: "Passwords do not match",
  CURRENT_PASSWORD_REQUIRED: "Current password is required",
} as const;

export type UpdateUserPasswordError =
  (typeof UpdateUserPasswordError)[keyof typeof UpdateUserPasswordError];

export const UpdateUserDetailsSchema = z.object({
  userId: z.uuid("Invalid user ID"),
  name: z.string().min(1, "Name is required").max(100, "Name is too long"),
  email: z.email("Invalid email address").optional(),
  image: z.string().optional(),
});

export const DeleteUserSchema = z.object({
  userId: z.uuid("Invalid user ID"),
});

export const UpdateUserPasswordSchema = z
  .object({
    userId: z.string().uuid("Invalid user ID"),
    // Submitted via FormData, so the value arrives as the string "true"/"false"
    // (or a real boolean from unit tests). Coerce to a boolean and default to
    // false when the field is absent.
    isCurrentUser: z
      .union([z.boolean(), z.literal("true"), z.literal("false")])
      .default(false)
      .transform((value) => value === true || value === "true"),
    newPassword: passwordSchema,
    confirmPassword: passwordSchema,
    currentPassword: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.newPassword !== data.confirmPassword) {
      ctx.addIssue({
        code: "custom",
        message: UpdateUserPasswordError.PASSWORD_MISMATCH,
      });
    }
    if (data.isCurrentUser && !data.currentPassword) {
      ctx.addIssue({
        code: "custom",
        message: UpdateUserPasswordError.CURRENT_PASSWORD_REQUIRED,
      });
    }
  });

export type UpdateUserRoleActionState = ActionState & {
  user?: BasicUserWithLastLogin | null;
};

export type DeleteUserActionState = ActionState & {
  redirect?: string;
};

export type UpdateUserActionState = ActionState & {
  user?: BasicUserWithLastLogin | null;
  currentUserUpdated?: boolean;
};

export type UpdateUserPasswordActionState = ActionState & {
  error?: UpdateUserPasswordError;
};
