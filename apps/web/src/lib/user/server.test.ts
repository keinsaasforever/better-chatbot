//@vitest-environment node

import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

// Mock server-only module
vi.mock("server-only", () => ({}));

// Mock dependencies
vi.mock("lib/db/repository", () => ({
  userRepository: {
    getUserById: vi.fn(),
    getUserStats: vi.fn(),
    getPreferences: vi.fn(),
    updateUserDetails: vi.fn(),
  },
}));

vi.mock("auth/server", () => ({
  auth: {
    api: {
      listUserAccounts: vi.fn(),
      listSessions: vi.fn(),
    },
  },
  getSession: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
}));

const { auth, getSession } = await import("auth/server");
const { headers } = await import("next/headers");
const { notFound } = await import("next/navigation");
import {
  getUserAccounts,
  getUserIdAndCheckAccess,
  updateUserDetails,
} from "./server";

/*
 * Tests focus on the business logic of the user server.
 */
describe("User Server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getUserAccounts - Account Type Detection", () => {
    beforeEach(() => {
      vi.mocked(getSession).mockResolvedValue({
        user: { id: "user-1" },
      } as any);
      vi.mocked(headers).mockResolvedValue(new Headers());
    });

    it("should correctly identify password vs OAuth accounts", async () => {
      const mockAccounts = [
        { providerId: "credential", id: "1" },
        { providerId: "google", id: "2" },
        { providerId: "github", id: "3" },
      ];
      vi.mocked(auth.api.listUserAccounts).mockResolvedValue(
        mockAccounts as any,
      );

      const result = await getUserAccounts("user-1");

      expect(result.hasPassword).toBe(true);
      expect(result.oauthProviders).toEqual(["google", "github"]);
    });

    it("should handle OAuth-only accounts", async () => {
      const mockAccounts = [
        { providerId: "google", id: "1" },
        { providerId: "github", id: "2" },
      ];
      vi.mocked(auth.api.listUserAccounts).mockResolvedValue(
        mockAccounts as any,
      );

      const result = await getUserAccounts("user-1");

      expect(result.hasPassword).toBe(false);
      expect(result.oauthProviders).toEqual(["google", "github"]);
    });

    it("should handle password-only accounts", async () => {
      const mockAccounts = [{ providerId: "credential", id: "1" }];
      vi.mocked(auth.api.listUserAccounts).mockResolvedValue(
        mockAccounts as any,
      );

      const result = await getUserAccounts("user-1");

      expect(result.hasPassword).toBe(true);
      expect(result.oauthProviders).toEqual([]);
    });

    it("should filter out credential provider from OAuth list", async () => {
      const mockAccounts = [
        { providerId: "credential", id: "1" },
        { providerId: "credential", id: "2" }, // multiple credential accounts
        { providerId: "google", id: "3" },
      ];
      vi.mocked(auth.api.listUserAccounts).mockResolvedValue(
        mockAccounts as any,
      );

      const result = await getUserAccounts("user-1");

      expect(result.hasPassword).toBe(true);
      expect(result.oauthProviders).toEqual(["google"]); // credential filtered out
    });
  });

  describe("getUserIdAndCheckAccess - Access Control Logic", () => {
    it("should use requested user ID when provided", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: { id: "current-user" },
      } as any);

      const result = await getUserIdAndCheckAccess("target-user");

      expect(result).toBe("target-user");
    });

    it("should fall back to current user ID when none provided", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: { id: "current-user" },
      } as any);

      const result = await getUserIdAndCheckAccess();

      expect(result).toBe("current-user");
    });

    it("should call notFound for falsy user IDs", async () => {
      vi.mocked(getSession).mockResolvedValue({ user: { id: "" } } as any);

      await getUserIdAndCheckAccess();

      expect(notFound).toHaveBeenCalled();
    });

    it("should handle null/undefined gracefully", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: { id: "fallback-user" },
      } as any);

      const result1 = await getUserIdAndCheckAccess(null as any);
      const result2 = await getUserIdAndCheckAccess(undefined);

      expect(result1).toBe("fallback-user");
      expect(result2).toBe("fallback-user");
    });
  });

  describe("updateUserDetails - User Update Logic", () => {
    let userRepository: any;

    beforeAll(async () => {
      const userRepositoryModule = await import("lib/db/repository");
      userRepository = userRepositoryModule.userRepository;
    });

    beforeEach(() => {
      vi.mocked(getSession).mockResolvedValue({
        user: { id: "current-user" },
      } as any);
    });

    it("should update user with provided fields", async () => {
      vi.mocked(userRepository.updateUserDetails).mockResolvedValue(undefined);

      await updateUserDetails(
        "user-1",
        "New Name",
        "new@email.com",
        "new-image.jpg",
      );

      expect(userRepository.updateUserDetails).toHaveBeenCalledWith({
        userId: "user-1",
        name: "New Name",
        email: "new@email.com",
        image: "new-image.jpg",
      });
    });

    it("should update only name when provided", async () => {
      vi.mocked(userRepository.updateUserDetails).mockResolvedValue(undefined);

      await updateUserDetails("user-1", "New Name");

      expect(userRepository.updateUserDetails).toHaveBeenCalledWith({
        userId: "user-1",
        name: "New Name",
      });
    });

    it("should update only email when provided", async () => {
      vi.mocked(userRepository.updateUserDetails).mockResolvedValue(undefined);

      await updateUserDetails("user-1", undefined, "new@email.com");

      expect(userRepository.updateUserDetails).toHaveBeenCalledWith({
        userId: "user-1",
        email: "new@email.com",
      });
    });

    it("should update only image when provided", async () => {
      vi.mocked(userRepository.updateUserDetails).mockResolvedValue(undefined);

      await updateUserDetails("user-1", undefined, undefined, "new-image.jpg");

      expect(userRepository.updateUserDetails).toHaveBeenCalledWith({
        userId: "user-1",
        image: "new-image.jpg",
      });
    });

    it("should return early when no fields provided", async () => {
      await updateUserDetails("user-1");

      expect(userRepository.updateUserDetails).not.toHaveBeenCalled();
    });

    it("should handle empty string values as falsy", async () => {
      await updateUserDetails("user-1", "", "", "");

      expect(userRepository.updateUserDetails).not.toHaveBeenCalled();
    });

    it("should use resolved user ID from access check", async () => {
      vi.mocked(userRepository.updateUserDetails).mockResolvedValue(undefined);

      await updateUserDetails("user-1", "New Name");

      expect(userRepository.updateUserDetails).toHaveBeenCalledWith({
        userId: "user-1",
        name: "New Name",
      });
    });
  });
});
