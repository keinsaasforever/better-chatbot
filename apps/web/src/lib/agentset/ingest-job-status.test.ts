import { describe, expect, it } from "vitest";
import {
  deriveAgentsetPipelineStatus,
  mapAgentsetIngestJobStatus,
  mapAgentsetPipelineStatus,
} from "./ingest-job-status";

describe("mapAgentsetPipelineStatus", () => {
  it("maps queued states to pending", () => {
    expect(mapAgentsetPipelineStatus("BACKLOG")).toBe("pending");
    expect(mapAgentsetPipelineStatus("QUEUED")).toBe("pending");
    expect(mapAgentsetPipelineStatus("PENDING")).toBe("pending");
  });

  it("normalizes mixed-case statuses", () => {
    expect(mapAgentsetPipelineStatus("completed")).toBe("completed");
    expect(mapAgentsetPipelineStatus("Processing")).toBe("processing");
  });

  it("maps active pipeline states to processing", () => {
    expect(mapAgentsetPipelineStatus("PRE_PROCESSING")).toBe("processing");
    expect(mapAgentsetPipelineStatus("PROCESSING")).toBe("processing");
  });

  it("maps terminal states", () => {
    expect(mapAgentsetPipelineStatus("COMPLETED")).toBe("completed");
    expect(mapAgentsetPipelineStatus("PROCESSED")).toBe("completed");
    expect(mapAgentsetPipelineStatus("FAILED")).toBe("failed");
    expect(mapAgentsetPipelineStatus("CANCELLED")).toBe("failed");
  });
});

describe("mapAgentsetIngestJobStatus", () => {
  it("remains compatible with ingest job status mapping", () => {
    expect(mapAgentsetIngestJobStatus("COMPLETED")).toBe("completed");
    expect(mapAgentsetIngestJobStatus("PENDING")).toBe("pending");
  });
});

describe("deriveAgentsetPipelineStatus", () => {
  it("prefers completed document status over processing job status", () => {
    expect(
      deriveAgentsetPipelineStatus({
        jobStatus: "PROCESSING",
        documentStatus: "COMPLETED",
      }),
    ).toBe("completed");
  });

  it("uses completedAt when status strings lag", () => {
    expect(
      deriveAgentsetPipelineStatus({
        jobStatus: "PROCESSING",
        jobCompletedAt: "2026-05-20T12:00:00.000Z",
      }),
    ).toBe("completed");
  });

  it("uses failedAt as terminal signal", () => {
    expect(
      deriveAgentsetPipelineStatus({
        jobStatus: "PROCESSING",
        jobFailedAt: "2026-05-20T12:00:00.000Z",
      }),
    ).toBe("failed");
  });
});
