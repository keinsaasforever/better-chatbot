import { describe, it, expect, beforeEach } from "vitest";
import { USER_ROLES } from "app-types/roles";
import { getUserAvatar, getIsUserAdmin } from "./utils";

describe("User Utils", () => {
  beforeEach(() => {
    delete process.env.DISABLE_DEFAULT_AVATAR;
  });

  describe("getUserAvatar - Avatar Selection Logic", () => {
    it("should prioritize user image over default", () => {
      const result = getUserAvatar({ image: "https://example.com/avatar.jpg" });
      expect(result).toBe("https://example.com/avatar.jpg");
    });

    it("should fall back to default avatar when no user image", () => {
      expect(getUserAvatar({ image: null })).toBe("/pf.webp");
      expect(getUserAvatar({})).toBe("/pf.webp");
      expect(getUserAvatar({ image: "" })).toBe("/pf.webp");
    });

    it("should respect DISABLE_DEFAULT_AVATAR environment flag", () => {
      process.env.DISABLE_DEFAULT_AVATAR = "true";

      expect(getUserAvatar({ image: null })).toBe("");
      expect(getUserAvatar({})).toBe("");

      // But still return user image when available
      expect(getUserAvatar({ image: "custom.jpg" })).toBe("custom.jpg");
    });
  });

  describe("getIsUserAdmin - Role Parsing Logic", () => {
    it("should detect admin role in single role", () => {
      expect(getIsUserAdmin({ role: USER_ROLES.ADMIN })).toBe(true);
      expect(getIsUserAdmin({ role: USER_ROLES.USER })).toBe(false);
      expect(getIsUserAdmin({ role: USER_ROLES.EDITOR })).toBe(false);
    });

    it("should detect admin role in comma-separated roles", () => {
      expect(
        getIsUserAdmin({ role: `${USER_ROLES.USER},${USER_ROLES.ADMIN}` }),
      ).toBe(true);
      expect(
        getIsUserAdmin({ role: `${USER_ROLES.ADMIN},${USER_ROLES.EDITOR}` }),
      ).toBe(true);
      expect(
        getIsUserAdmin({ role: `${USER_ROLES.USER},${USER_ROLES.EDITOR}` }),
      ).toBe(false);
    });

    it("should handle edge cases gracefully", () => {
      expect(getIsUserAdmin({ role: null })).toBe(false);
      expect(getIsUserAdmin({})).toBe(false);
      expect(getIsUserAdmin({ role: "" })).toBe(false);
    });

    it("should require exact string match (case sensitive)", () => {
      expect(getIsUserAdmin({ role: "ADMIN" })).toBe(false); // wrong case
      expect(getIsUserAdmin({ role: " admin " })).toBe(false); // whitespace
    });
    it("should handle undefined user", () => {
      expect(getIsUserAdmin(undefined)).toBe(false);
    });
  });
});
