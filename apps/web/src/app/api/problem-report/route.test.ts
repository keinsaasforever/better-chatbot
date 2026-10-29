import { afterEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  sendNotificationEmail: vi.fn(),
  raiseProblemReportIncident: vi.fn(),
  update: vi.fn(),
  flushLogs: vi.fn(),
  after: vi.fn(),
}));

vi.mock("auth/route-guard", () => ({
  withAuth:
    (
      handler: (
        request: Request,
        session: {
          user: { id: string; email: string; name: string };
          session: { activeOrganizationId: string | null };
        },
      ) => Promise<Response>,
    ) =>
    (request: Request) =>
      handler(request, {
        user: {
          id: "11111111-2222-3333-4444-555555555555",
          email: "user@example.com",
          name: "Ada Lovelace",
        },
        session: { activeOrganizationId: "org_42" },
      }),
}));

vi.mock("lib/db/repository", () => ({
  problemReportRepository: { create: mocks.create },
}));

// The route writes the trace id back with a raw Drizzle update; the chained
// builder is stubbed so no DB is needed (repo tests are DB-free by convention).
vi.mock("lib/db/pg/db.pg", () => ({
  pgDb: {
    update: () => ({
      set: (values: unknown) => ({
        where: () => {
          mocks.update(values);
          return Promise.resolve();
        },
      }),
    }),
  },
}));

vi.mock("lib/db/pg/schema.pg", () => ({ ProblemReportTable: { id: "id" } }));

vi.mock("lib/gate", () => ({
  sendNotificationEmail: mocks.sendNotificationEmail,
}));

// Only the emitter is stubbed: `notification.ts` imports `incidentTitle` from
// this same module, so replacing the whole module would break the email builder.
vi.mock("lib/problem-report/superlog-incident", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("lib/problem-report/superlog-incident")
  >()),
  raiseProblemReportIncident: mocks.raiseProblemReportIncident,
}));

vi.mock("lib/observability/register", () => ({ flushLogs: mocks.flushLogs }));

vi.mock("next/server", async () => {
  const actual =
    await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual, after: mocks.after };
});

vi.mock("logger", () => ({
  default: {
    withDefaults: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  },
}));

import type { NextRequest } from "next/server";
import { POST } from "./route";

const REPORT_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

function request(body: unknown) {
  return new Request("http://localhost/api/problem-report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as unknown as NextRequest;
}

afterEach(() => vi.clearAllMocks());

describe("POST /api/problem-report", () => {
  test("stores the report, raises an incident and mails the tech inbox", async () => {
    mocks.create.mockResolvedValue({ id: REPORT_ID });
    mocks.raiseProblemReportIncident.mockReturnValue(
      "0af7651916cd43dd8448eb211c80319c",
    );

    const res = await POST(
      request({
        description: "  Voice input dies mid-sentence  ",
        screenshots: [
          {
            key: "user/1-shot.png",
            url: "https://storage.example.com/shot.png",
            name: "shot.png",
            contentType: "image/png",
            size: 42,
          },
        ],
        context: { pageUrl: "https://app.keinsaas.com/chat/abc", locale: "de" },
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: REPORT_ID,
      traceId: "0af7651916cd43dd8448eb211c80319c",
    });

    // Description is stored trimmed, and scoped to the active organization.
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "11111111-2222-3333-4444-555555555555",
        organizationId: "org_42",
        description: "Voice input dies mid-sentence",
      }),
    );

    expect(mocks.raiseProblemReportIncident).toHaveBeenCalledWith(
      expect.objectContaining({ reportId: REPORT_ID, screenshotCount: 1 }),
    );

    // The trace id is written back so the row links to the incident.
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ traceId: "0af7651916cd43dd8448eb211c80319c" }),
    );

    const email = mocks.sendNotificationEmail.mock.calls[0][0];
    expect(email.to).toBe("tech@keinsaas.com");
    expect(email.body).toContain("https://storage.example.com/shot.png");

    // The incident log record must not be lost to the serverless freeze.
    expect(mocks.after).toHaveBeenCalledWith(mocks.flushLogs);
  });

  test("rejects an empty description without touching any side effect", async () => {
    const res = await POST(request({ description: "   " }));

    expect(res.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.raiseProblemReportIncident).not.toHaveBeenCalled();
    expect(mocks.sendNotificationEmail).not.toHaveBeenCalled();
  });

  test("rejects a malformed body", async () => {
    expect((await POST(request("not json"))).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  test("still succeeds when telemetry and mail both fail", async () => {
    mocks.create.mockResolvedValue({ id: REPORT_ID });
    mocks.raiseProblemReportIncident.mockReturnValue(undefined);
    mocks.sendNotificationEmail.mockRejectedValue(new Error("smtp down"));

    const res = await POST(
      request({ description: "Upload button does nothing" }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: REPORT_ID, traceId: null });
    // No trace to store, so no write-back.
    expect(mocks.update).not.toHaveBeenCalled();
  });

  test("returns a generic 500 when the report cannot be stored", async () => {
    mocks.create.mockRejectedValue(new Error("pool exhausted"));

    const res = await POST(request({ description: "Chat is blank" }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to submit report" });
    expect(mocks.sendNotificationEmail).not.toHaveBeenCalled();
  });
});
