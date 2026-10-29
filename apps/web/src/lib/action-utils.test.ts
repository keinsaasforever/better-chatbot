import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { USER_ROLES } from "app-types/roles";

// Mock server-only module
vi.mock("server-only", () => ({}));

// Mock the auth modules
vi.mock("auth/server", () => ({
  getSession: vi.fn(),
}));

// Import after mocks
import { validatedAction, validatedActionWithUser } from "./action-utils";

const { getSession } = await import("auth/server");

describe("action-utils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("validatedAction", () => {
    it("should validate form data and call action with valid data", async () => {
      const schema = z.object({
        name: z.string(),
        age: z.string().transform(Number),
      });

      const mockAction = vi.fn().mockResolvedValue({ success: true });
      const wrappedAction = validatedAction(schema, mockAction);

      const formData = new FormData();
      formData.set("name", "John");
      formData.set("age", "25");

      const result = await wrappedAction({}, formData);

      expect(mockAction).toHaveBeenCalledWith(
        { name: "John", age: 25 },
        formData,
      );
      expect(result).toEqual({ success: true });
    });

    it("should return error when validation fails", async () => {
      const schema = z.object({
        email: z.string().email(),
      });

      const mockAction = vi.fn();
      const wrappedAction = validatedAction(schema, mockAction);

      const formData = new FormData();
      formData.set("email", "invalid-email");

      const result = await wrappedAction({}, formData);

      expect(mockAction).not.toHaveBeenCalled();
      expect(result).toHaveProperty("error");
      expect((result as any).error).toContain("Invalid email");
    });
  });

  describe("validatedActionWithUser", () => {
    it("should call action with user when authenticated", async () => {
      const mockUser = {
        id: "user-1",
        name: "John Doe",
        email: "john@example.com",
        role: USER_ROLES.USER,
      };

      vi.mocked(getSession).mockResolvedValue({
        user: mockUser,
        session: {} as any,
      } as any);

      const schema = z.object({ data: z.string() });
      const mockAction = vi.fn().mockResolvedValue({ success: true });
      const wrappedAction = validatedActionWithUser(schema, mockAction);

      const formData = new FormData();
      formData.set("data", "test");

      const result = await wrappedAction({}, formData);

      expect(mockAction).toHaveBeenCalledWith(
        { data: "test" },
        formData,
        mockUser,
      );
      expect(result).toEqual({ success: true });
    });

    it("should return error when user is not authenticated", async () => {
      vi.mocked(getSession).mockRejectedValue(new Error("Unauthorized"));

      const schema = z.object({ data: z.string() });
      const mockAction = vi.fn();
      const wrappedAction = validatedActionWithUser(schema, mockAction);

      const formData = new FormData();
      formData.set("data", "test");

      const result = await wrappedAction({}, formData);

      expect(mockAction).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        message: "User is not authenticated",
      });
    });
  });
});
