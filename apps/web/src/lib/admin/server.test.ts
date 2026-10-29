import { describe, it, expect, vi, beforeEach } from "vitest";
import { USER_ROLES } from "app-types/roles";

// Mock server-only module
vi.mock("server-only", () => ({}));

// Mock the auth module
vi.mock("lib/auth/server", () => ({
  getSession: vi.fn(),
}));

// Mock the new permission system
vi.mock("lib/auth/permissions", () => ({
  requireAdminPermission: vi.fn(),
  requireUserListPermission: vi.fn(),
  hasAdminPermission: vi.fn(),
  canListUsers: vi.fn(),
}));

// Mock the admin repository
vi.mock("lib/db/pg/repositories/admin-repository.pg", () => ({
  default: {
    getUsers: vi.fn(),
  },
}));

// Mock next/headers
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

// Import after mocks
import {
  requireAdminSession,
  getAdminUsers,
  ADMIN_USER_LIST_LIMIT,
  DEFAULT_SORT_BY,
  DEFAULT_SORT_DIRECTION,
} from "./server";
import { getSession } from "lib/auth/server";
import {
  requireAdminPermission,
  requireUserListPermission,
  hasAdminPermission,
  canListUsers,
} from "lib/auth/permissions";
import pgAdminRepository from "lib/db/pg/repositories/admin-repository.pg";

describe("Admin Server - Business Logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("requireAdminSession - Admin Role Detection", () => {
    it("should detect admin role case-insensitively", async () => {
      const testCases = [
        { role: "admin", shouldPass: true },
        { role: "ADMIN", shouldPass: true },
        { role: "Admin", shouldPass: true },
        { role: "user,admin", shouldPass: true },
        { role: "ADMIN,editor", shouldPass: true },
        { role: "user", shouldPass: false },
        { role: "editor", shouldPass: false },
        { role: "USER,EDITOR", shouldPass: false },
        { role: "", shouldPass: false },
        { role: null, shouldPass: false },
        { role: undefined, shouldPass: false },
      ];

      for (const testCase of testCases) {
        const mockSession = {
          user: { id: "test-user", role: testCase.role },
          session: { id: "session-1" },
        };

        vi.mocked(getSession).mockResolvedValue(mockSession as any);

        if (testCase.shouldPass) {
          vi.mocked(hasAdminPermission).mockResolvedValue(true);
          vi.mocked(requireAdminPermission).mockResolvedValue(undefined);
          const result = await requireAdminSession();
          expect(result).toEqual(mockSession);
        } else {
          vi.mocked(hasAdminPermission).mockResolvedValue(false);
          vi.mocked(requireAdminPermission).mockRejectedValue(
            new Error(
              "Unauthorized: Admin access required to access admin functions",
            ),
          );
          await expect(requireAdminSession()).rejects.toThrow(
            "Unauthorized: Admin access required to access admin functions",
          );
        }
      }
    });
  });

  describe("getAdminUsers - Query Parameter Handling", () => {
    beforeEach(() => {
      // Mock admin session by default
      vi.mocked(getSession).mockResolvedValue({
        user: { id: "admin-1", role: USER_ROLES.ADMIN },
      } as any);
      // Mock permissions by default
      vi.mocked(canListUsers).mockResolvedValue(true);
      vi.mocked(requireUserListPermission).mockResolvedValue(undefined);
    });

    it("should apply correct defaults when no query provided", async () => {
      vi.mocked(pgAdminRepository.getUsers).mockResolvedValue({
        users: [],
        total: 0,
        limit: ADMIN_USER_LIST_LIMIT,
        offset: 0,
      } as any);

      await getAdminUsers();

      expect(pgAdminRepository.getUsers).toHaveBeenCalledWith({
        searchValue: undefined,
        searchField: undefined,
        searchOperator: undefined,
        limit: ADMIN_USER_LIST_LIMIT, // default
        offset: 0, // default
        sortBy: DEFAULT_SORT_BY, // default
        sortDirection: DEFAULT_SORT_DIRECTION, // default
        filterField: undefined,
        filterValue: undefined,
        filterOperator: undefined,
      });
    });

    it("should override defaults with provided query parameters", async () => {
      vi.mocked(pgAdminRepository.getUsers).mockResolvedValue({
        users: [],
        total: 0,
        limit: 25,
        offset: 50,
      } as any);

      const customQuery = {
        limit: 25,
        offset: 50,
        sortBy: "name" as const,
        sortDirection: "asc" as const,
        searchValue: "john",
        searchField: "email" as const,
      };

      await getAdminUsers(customQuery);

      expect(pgAdminRepository.getUsers).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 25,
          offset: 50,
          sortBy: "name",
          sortDirection: "asc",
          searchValue: "john",
          searchField: "email",
        }),
      );
    });

    it("should handle response format variations", async () => {
      // Test case 1: Response with limit/offset fields
      vi.mocked(pgAdminRepository.getUsers).mockResolvedValue({
        users: [{ id: "1" }],
        total: 1,
        limit: 5,
        offset: 10,
      } as any);

      const result1 = await getAdminUsers({ limit: 20, offset: 30 });

      expect(result1).toEqual({
        users: [{ id: "1" }],
        total: 1,
        limit: 5, // from response
        offset: 10, // from response
      });

      // Test case 2: Response without limit/offset fields
      vi.mocked(pgAdminRepository.getUsers).mockResolvedValue({
        users: [{ id: "2" }],
        total: 1,
        limit: 20,
        offset: 30,
      } as any);

      const result2 = await getAdminUsers({ limit: 20, offset: 30 });

      expect(result2).toEqual({
        users: [{ id: "2" }],
        total: 1,
        limit: 20,
        offset: 30,
      });
    });

    it("should handle edge case responses", async () => {
      // Test malformed/missing response
      vi.mocked(pgAdminRepository.getUsers).mockResolvedValue({
        users: [],
        total: 0,
        limit: ADMIN_USER_LIST_LIMIT,
        offset: 0,
      } as any);

      const result = await getAdminUsers();

      expect(result).toEqual({
        users: [],
        total: 0,
        limit: ADMIN_USER_LIST_LIMIT,
        offset: 0,
      });
    });

    it("should enforce admin access before making API call", async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: { id: "user-1", role: USER_ROLES.USER },
      } as any);
      vi.mocked(canListUsers).mockResolvedValue(false);
      vi.mocked(requireUserListPermission).mockRejectedValue(
        new Error(
          "Unauthorized: Permission required to list users in admin panel",
        ),
      );

      await expect(getAdminUsers()).rejects.toThrow(
        "Unauthorized: Permission required to list users in admin panel",
      );

      // Should not make the API call if not admin
      expect(pgAdminRepository.getUsers).not.toHaveBeenCalled();
    });
  });

  describe("Constants", () => {
    it("should have correct default values", () => {
      expect(ADMIN_USER_LIST_LIMIT).toBe(10);
      expect(DEFAULT_SORT_BY).toBe("createdAt");
      expect(DEFAULT_SORT_DIRECTION).toBe("desc");
    });
  });
});
