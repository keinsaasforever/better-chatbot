import { describe, expect, it, vi } from "vitest";
import { UnprocessableEntityError } from "agentset";
import {
  fetchIngestJobSnapshot,
  isIngestJobFetchUnavailableError,
} from "./ingest-job-fetch";

describe("isIngestJobFetchUnavailableError", () => {
  it("detects Agentset 422 ingest job fetch errors", () => {
    expect(
      isIngestJobFetchUnavailableError(
        new UnprocessableEntityError(
          "invalid_type: createdAt: Invalid input: expected date, received string",
        ),
      ),
    ).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isIngestJobFetchUnavailableError(new Error("Unauthorized"))).toBe(
      false,
    );
  });
});

describe("fetchIngestJobSnapshot", () => {
  it("returns null when ingest job GET is temporarily unavailable", async () => {
    const snapshot = await fetchIngestJobSnapshot(
      {
        get: vi
          .fn()
          .mockRejectedValue(
            new UnprocessableEntityError(
              "invalid_type: createdAt: Invalid input: expected date, received string",
            ),
          ),
      },
      "job_123",
    );

    expect(snapshot).toBeNull();
  });

  it("returns job data when GET succeeds", async () => {
    const snapshot = await fetchIngestJobSnapshot(
      {
        get: vi.fn().mockResolvedValue({
          status: "COMPLETED",
          completedAt: "2026-05-20T12:00:00.000Z",
        }),
      },
      "job_123",
    );

    expect(snapshot).toEqual({
      status: "COMPLETED",
      completedAt: "2026-05-20T12:00:00.000Z",
    });
  });
});
