import { describe, expect, it } from "vitest";
import {
  getProjectDraftThreadId,
  getProjectIdFromDraftThreadId,
  isProjectDraftThreadId,
} from "./project-draft-thread";

describe("project-draft-thread", () => {
  it("builds and detects draft thread ids", () => {
    const draftId = getProjectDraftThreadId("abc-123");
    expect(isProjectDraftThreadId(draftId)).toBe(true);
    expect(getProjectIdFromDraftThreadId(draftId)).toBe("abc-123");
  });
});
