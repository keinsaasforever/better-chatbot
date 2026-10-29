import "server-only";
import { z } from "zod";
import { UserSession, UserSessionUser } from "app-types/user";

import { getSession } from "auth/server";
import {
  requireAdminPermission,
  requireUserManagePermissionFor,
} from "./auth/permissions";

// Type constraint for schemas that can have optional userId
type SchemaWithOptionalUserId = z.ZodType<{ userId?: string }, any>;

export type ActionState =
  | {
      success?: boolean;
      message?: string;
      [key: string]: any;
    }
  | null
  | undefined;

type ValidatedActionFunction<S extends z.ZodType<any, any>, T> = (
  data: z.infer<S>,
  formData: FormData,
) => Promise<T>;

export function validatedAction<S extends z.ZodType<any, any>, T>(
  schema: S,
  action: ValidatedActionFunction<S, T>,
) {
  return async (_prevState: ActionState, formData: FormData) => {
    const result = schema.safeParse(Object.fromEntries(formData));
    if (!result.success) {
      return { error: result.error.issues[0].message };
    }

    return action(result.data, formData);
  };
}

type ValidatedActionWithUserFunction<S extends z.ZodType<any, any>, T> = (
  data: z.infer<S>,
  formData: FormData,
  user: UserSessionUser,
) => Promise<T>;

export function validatedActionWithUser<S extends z.ZodType<any, any>, T>(
  schema: S,
  action: ValidatedActionWithUserFunction<S, T>,
) {
  return async (_prevState: ActionState, formData: FormData) => {
    let session;
    try {
      session = await getSession();
    } catch {
      return {
        success: false,
        message: "User is not authenticated",
      } as T;
    }

    if (!session || !session.user) {
      return {
        success: false,
        message: "User is not authenticated",
      } as T;
    }

    const result = schema.safeParse(Object.fromEntries(formData));
    if (!result.success) {
      return {
        success: false,
        message: result.error.issues[0].message,
      } as T;
    }

    return action(result.data, formData, session.user);
  };
}

// ========== PERMISSION-BASED VALIDATORS ==========

type ValidatedActionWithSimpleAdminAccess<S extends z.ZodType<any, any>, T> = (
  data: z.infer<S>,
  formData: FormData,
  userSession: UserSession,
) => Promise<T>;

/**
 * Validates action and requires admin permissions
 */
export function validatedActionWithAdminPermission<
  S extends z.ZodType<any, any>,
  T,
>(schema: S, action: ValidatedActionWithSimpleAdminAccess<S, T>) {
  return async (_prevState: ActionState, formData: FormData) => {
    let userSession;
    try {
      userSession = await getSession();
    } catch {
      return {
        success: false,
        message: "User is not authenticated",
      } as T;
    }

    if (!userSession || !userSession.user) {
      return {
        success: false,
        message: "User is not authenticated",
      } as T;
    }

    const result = schema.safeParse(Object.fromEntries(formData));
    if (!result.success) {
      return {
        success: false,
        message: result.error.issues[0].message,
      } as T;
    }

    // Check admin permissions
    try {
      await requireAdminPermission();
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "You are not authorized to perform this action",
      } as T;
    }

    return action(result.data, formData, userSession);
  };
}

type ValidatedActionWithUserManageAccess<S extends z.ZodType<any, any>, T> = (
  data: z.infer<S>,
  userId: string,
  userSession: UserSession,
  isOwnResource: boolean,
  formData: FormData,
) => Promise<T>;

/**
 * Validates action and allows if user manages themselves OR has user management permissions
 */
export function validatedActionWithUserManagePermission<
  S extends SchemaWithOptionalUserId,
  T,
>(schema: S, action: ValidatedActionWithUserManageAccess<S, T>) {
  return async (_prevState: ActionState, formData: FormData) => {
    let userSession;
    try {
      userSession = await getSession();
    } catch {
      return {
        success: false,
        message: "User is not authenticated",
      } as T;
    }

    if (!userSession || !userSession.user) {
      return {
        success: false,
        message: "User is not authenticated",
      } as T;
    }

    const result = schema.safeParse(Object.fromEntries(formData));
    if (!result.success) {
      return {
        success: false,
        message: result.error.issues[0].message,
      } as T;
    }

    const userId = result.data.userId || userSession.user.id;

    // Check permissions using our simplified permission system
    try {
      await requireUserManagePermissionFor(userId);
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "You are not authorized to perform this action",
      } as T;
    }

    const isOwnResource = userId === userSession.user.id;
    return action(result.data, userId, userSession, isOwnResource, formData);
  };
}
