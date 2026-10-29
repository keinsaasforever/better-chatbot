import { describe, it, expect } from "vitest";
import { UpdateUserRoleSchema } from "./validations";
import { USER_ROLES } from "app-types/roles";

describe("Admin Validations", () => {
  describe("UpdateUserRoleSchema", () => {
    it("should validate correct user role update data", () => {
      const validData = {
        userId: "123e4567-e89b-12d3-a456-426614174000",
        role: USER_ROLES.ADMIN,
      };

      const result = UpdateUserRoleSchema.safeParse(validData);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validData);
      }
    });

    it("should validate with optional role field", () => {
      const validData = {
        userId: "123e4567-e89b-12d3-a456-426614174000",
      };

      const result = UpdateUserRoleSchema.safeParse(validData);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.role).toBeUndefined();
        expect(result.data.userId).toBe("123e4567-e89b-12d3-a456-426614174000");
      }
    });

    it("should accept all valid user roles", () => {
      const roles = [USER_ROLES.USER, USER_ROLES.EDITOR, USER_ROLES.ADMIN];

      for (const role of roles) {
        const validData = {
          userId: "123e4567-e89b-12d3-a456-426614174000",
          role,
        };

        const result = UpdateUserRoleSchema.safeParse(validData);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.role).toBe(role);
        }
      }
    });

    it("should reject invalid UUID format", () => {
      const invalidData = {
        userId: "not-a-uuid",
        role: USER_ROLES.USER,
      };

      const result = UpdateUserRoleSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("Invalid user ID");
      }
    });

    it("should reject invalid role values", () => {
      const invalidData = {
        userId: "123e4567-e89b-12d3-a456-426614174000",
        role: "INVALID_ROLE",
      };

      const result = UpdateUserRoleSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.length).toBeGreaterThan(0);
      }
    });

    it("should reject empty userId", () => {
      const invalidData = {
        userId: "",
        role: USER_ROLES.USER,
      };

      const result = UpdateUserRoleSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("Invalid user ID");
      }
    });

    it("should reject missing userId", () => {
      const invalidData = {
        role: USER_ROLES.USER,
      };

      const result = UpdateUserRoleSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it("should handle various UUID formats", () => {
      const validUUIDs = [
        "123e4567-e89b-12d3-a456-426614174000", // lowercase
        "123E4567-E89B-12D3-A456-426614174000", // uppercase
        "550e8400-e29b-41d4-a716-446655440000", // different UUID
      ];

      for (const uuid of validUUIDs) {
        const validData = {
          userId: uuid,
          role: USER_ROLES.USER,
        };

        const result = UpdateUserRoleSchema.safeParse(validData);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.userId).toBe(uuid);
        }
      }
    });

    it("should reject malformed UUIDs", () => {
      const invalidUUIDs = [
        "123e4567-e89b-12d3-a456", // too short
        "123e4567-e89b-12d3-a456-426614174000-extra", // too long
        "123g4567-e89b-12d3-a456-426614174000", // invalid character 'g'
        "123e4567e89b12d3a456426614174000", // missing dashes
        "123e4567-e89b-12d3-a456-42661417400", // missing last character
      ];

      for (const uuid of invalidUUIDs) {
        const invalidData = {
          userId: uuid,
          role: USER_ROLES.USER,
        };

        const result = UpdateUserRoleSchema.safeParse(invalidData);
        expect(result.success).toBe(false);
      }
    });

    it("should work with role enum values exactly", () => {
      // Test that the enum values match exactly what's expected
      expect(USER_ROLES.USER).toBe("user");
      expect(USER_ROLES.EDITOR).toBe("editor");
      expect(USER_ROLES.ADMIN).toBe("admin");

      const testData = {
        userId: "123e4567-e89b-12d3-a456-426614174000",
        role: "user" as const,
      };

      const result = UpdateUserRoleSchema.safeParse(testData);
      expect(result.success).toBe(true);
    });

    it("should validate against actual role string values", () => {
      const roleStrings = ["user", "editor", "admin"];

      for (const roleString of roleStrings) {
        const validData = {
          userId: "123e4567-e89b-12d3-a456-426614174000",
          role: roleString,
        };

        const result = UpdateUserRoleSchema.safeParse(validData);
        expect(result.success).toBe(true);
      }
    });
  });
});
