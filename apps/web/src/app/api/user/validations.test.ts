import { describe, it, expect } from "vitest";
import {
  UpdateUserDetailsSchema,
  UpdateUserRoleSchema,
  DeleteUserSchema,
  UpdateUserPasswordSchema,
  UpdateUserPasswordError,
} from "./validations";
import { USER_ROLES } from "app-types/roles";

describe("User Validations", () => {
  describe("UpdateUserDetailsSchema", () => {
    it("should validate correct user details", () => {
      const validData = {
        userId: "123e4567-e89b-12d3-a456-426614174000",
        name: "John Doe",
        email: "john.doe@example.com",
      };

      const result = UpdateUserDetailsSchema.safeParse(validData);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validData);
      }
    });

    it("should reject invalid UUID format", () => {
      const invalidData = {
        userId: "not-a-uuid",
        name: "John Doe",
        email: "john.doe@example.com",
      };

      const result = UpdateUserDetailsSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("Invalid user ID");
      }
    });

    it("should reject empty name", () => {
      const invalidData = {
        userId: "123e4567-e89b-12d3-a456-426614174000",
        name: "",
        email: "john.doe@example.com",
      };

      const result = UpdateUserDetailsSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("Name is required");
      }
    });

    it("should reject name that is too long", () => {
      const invalidData = {
        userId: "123e4567-e89b-12d3-a456-426614174000",
        name: "a".repeat(101), // 101 characters
        email: "john.doe@example.com",
      };

      const result = UpdateUserDetailsSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("Name is too long");
      }
    });

    it("should accept name at maximum length", () => {
      const validData = {
        userId: "123e4567-e89b-12d3-a456-426614174000",
        name: "a".repeat(100), // 100 characters (max)
        email: "john.doe@example.com",
      };

      const result = UpdateUserDetailsSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it("should reject invalid email format", () => {
      const invalidData = {
        userId: "123e4567-e89b-12d3-a456-426614174000",
        name: "John Doe",
        email: "not-an-email",
      };

      const result = UpdateUserDetailsSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("Invalid email address");
      }
    });

    it("should accept various valid email formats", () => {
      const validEmails = [
        "test@example.com",
        "user.name@example.com",
        "user+tag@example.com",
        "user123@example-domain.co.uk",
      ];

      for (const email of validEmails) {
        const validData = {
          userId: "123e4567-e89b-12d3-a456-426614174000",
          name: "John Doe",
          email,
        };

        const result = UpdateUserDetailsSchema.safeParse(validData);
        expect(result.success).toBe(true);
      }
    });
  });

  describe("UpdateUserRoleSchema", () => {
    it("should validate correct role data", () => {
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

    it("should validate with optional role", () => {
      const validData = {
        userId: "123e4567-e89b-12d3-a456-426614174000",
      };

      const result = UpdateUserRoleSchema.safeParse(validData);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.role).toBeUndefined();
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
      }
    });

    it("should reject invalid role", () => {
      const invalidData = {
        userId: "123e4567-e89b-12d3-a456-426614174000",
        role: "INVALID_ROLE",
      };

      const result = UpdateUserRoleSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it("should reject invalid UUID", () => {
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
  });

  describe("DeleteUserSchema", () => {
    it("should validate correct user ID", () => {
      const validData = {
        userId: "123e4567-e89b-12d3-a456-426614174000",
      };

      const result = DeleteUserSchema.safeParse(validData);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validData);
      }
    });

    it("should reject invalid UUID format", () => {
      const invalidData = {
        userId: "not-a-uuid",
      };

      const result = DeleteUserSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("Invalid user ID");
      }
    });

    it("should reject missing userId", () => {
      const invalidData = {};

      const result = DeleteUserSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });
  });

  describe("UpdateUserPasswordSchema", () => {
    it("should validate correct password data", () => {
      const validData = {
        userId: "123e4567-e89b-12d3-a456-426614174000",
        isCurrentUser: false,
        newPassword: "SecurePass123!",
        confirmPassword: "SecurePass123!",
      };

      const result = UpdateUserPasswordSchema.safeParse(validData);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validData);
      }
    });

    it("should reject when passwords do not match", () => {
      const invalidData = {
        userId: "123e4567-e89b-12d3-a456-426614174000",
        isCurrentUser: false,
        newPassword: "SecurePass123!",
        confirmPassword: "DifferentPass123!",
      };

      const result = UpdateUserPasswordSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe(
          UpdateUserPasswordError.PASSWORD_MISMATCH,
        );
      }
    });

    it("should reject invalid UUID", () => {
      const invalidData = {
        userId: "not-a-uuid",
        isCurrentUser: false,
        newPassword: "SecurePass123!",
        confirmPassword: "SecurePass123!",
      };

      const result = UpdateUserPasswordSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("Invalid user ID");
      }
    });

    it("should validate password strength requirements", () => {
      // Test weak passwords that should fail password schema validation
      const weakPasswords = [
        "short", // too short
        "12345678", // only numbers
        "password", // only lowercase
        "PASSWORD", // only uppercase
      ];

      for (const weakPassword of weakPasswords) {
        const invalidData = {
          userId: "123e4567-e89b-12d3-a456-426614174000",
          isCurrentUser: false,
          newPassword: weakPassword,
          confirmPassword: weakPassword,
        };

        const result = UpdateUserPasswordSchema.safeParse(invalidData);
        expect(result.success).toBe(false);
      }
    });

    it("should accept strong passwords", () => {
      const strongPasswords = [
        "StrongPass123!",
        "MySecure@Password1",
        "ComplexP@ssw0rd",
      ];

      for (const strongPassword of strongPasswords) {
        const validData = {
          userId: "123e4567-e89b-12d3-a456-426614174000",
          isCurrentUser: false,
          newPassword: strongPassword,
          confirmPassword: strongPassword,
        };

        const result = UpdateUserPasswordSchema.safeParse(validData);
        expect(result.success).toBe(true);
      }
    });

    it("should coerce isCurrentUser from FormData string values", () => {
      const formLikeData = {
        userId: "123e4567-e89b-12d3-a456-426614174000",
        isCurrentUser: "false",
        newPassword: "SecurePass123!",
        confirmPassword: "SecurePass123!",
      };

      const result = UpdateUserPasswordSchema.safeParse(formLikeData);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isCurrentUser).toBe(false);
      }
    });

    it("should default isCurrentUser to false when the field is absent", () => {
      // Reproduces the admin flow: the form omitted isCurrentUser, which used
      // to fail with "expected boolean, received undefined".
      const dataWithoutFlag = {
        userId: "123e4567-e89b-12d3-a456-426614174000",
        newPassword: "SecurePass123!",
        confirmPassword: "SecurePass123!",
      };

      const result = UpdateUserPasswordSchema.safeParse(dataWithoutFlag);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isCurrentUser).toBe(false);
      }
    });

    it("should require currentPassword when isCurrentUser is the string 'true'", () => {
      const formLikeData = {
        userId: "123e4567-e89b-12d3-a456-426614174000",
        isCurrentUser: "true",
        newPassword: "SecurePass123!",
        confirmPassword: "SecurePass123!",
      };

      const result = UpdateUserPasswordSchema.safeParse(formLikeData);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe(
          UpdateUserPasswordError.CURRENT_PASSWORD_REQUIRED,
        );
      }
    });

    it("should reject missing required fields", () => {
      const incompleteData = {
        userId: "123e4567-e89b-12d3-a456-426614174000",
        newPassword: "SecurePass123!",
        // missing confirmPassword
      };

      const result = UpdateUserPasswordSchema.safeParse(incompleteData);
      expect(result.success).toBe(false);
    });
  });

  describe("UpdateUserPasswordError constants", () => {
    it("should have correct error message for password mismatch", () => {
      expect(UpdateUserPasswordError.PASSWORD_MISMATCH).toBe(
        "Passwords do not match",
      );
    });
  });
});
