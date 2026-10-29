import { SeverityNumber } from "@opentelemetry/api-logs";
import type { LogObject, LogType } from "consola";
import { beforeEach, describe, expect, it, vi } from "vitest";

const emit = vi.fn();

vi.mock("@opentelemetry/api-logs", async () => {
  const actual = await vi.importActual<
    typeof import("@opentelemetry/api-logs")
  >("@opentelemetry/api-logs");
  return {
    ...actual,
    logs: { getLogger: () => ({ emit }) },
  };
});

const { createOtelReporter } = await import("./consola-otel-reporter");

const logObject = (overrides: Partial<LogObject> = {}): LogObject =>
  ({
    type: "info",
    level: 3,
    tag: "keinsaas-navigator",
    args: [],
    date: new Date(0),
    ...overrides,
  }) as LogObject;

describe("createOtelReporter", () => {
  beforeEach(() => {
    emit.mockClear();
  });

  it("maps consola types to the matching severity", () => {
    const reporter = createOtelReporter();
    if (!reporter) throw new Error("expected a reporter in a server runtime");

    const cases: Array<[LogType, SeverityNumber]> = [
      ["error", SeverityNumber.ERROR],
      ["fatal", SeverityNumber.FATAL],
      ["warn", SeverityNumber.WARN],
      ["debug", SeverityNumber.DEBUG],
      ["trace", SeverityNumber.TRACE],
      ["info", SeverityNumber.INFO],
      // Unknown consola types must not throw or drop the line.
      ["success", SeverityNumber.INFO],
    ];

    for (const [type, expected] of cases) {
      emit.mockClear();
      reporter.log(logObject({ type, args: ["hello"] }), {} as never);
      expect(emit.mock.calls[0][0].severityNumber, type).toBe(expected);
    }
  });

  it("promotes plain objects to attributes and keeps text in the body", () => {
    const reporter = createOtelReporter();
    if (!reporter) throw new Error("expected a reporter in a server runtime");

    reporter.log(
      logObject({ args: ["chat finished", { threadId: "t1", ttftMs: 120 }] }),
      {} as never,
    );

    const record = emit.mock.calls[0][0];
    expect(record.body).toBe("chat finished");
    expect(record.attributes).toMatchObject({
      threadId: "t1",
      ttftMs: 120,
      "log.tag": "keinsaas-navigator",
      "log.type": "info",
    });
  });

  it("unpacks Errors into exception attributes", () => {
    const reporter = createOtelReporter();
    if (!reporter) throw new Error("expected a reporter in a server runtime");

    reporter.log(
      logObject({ type: "error", args: [new TypeError("gateway exploded")] }),
      {} as never,
    );

    expect(emit.mock.calls[0][0].attributes).toMatchObject({
      "exception.type": "TypeError",
      "exception.message": "gateway exploded",
    });
  });

  it("strips ANSI colour codes so the same message groups consistently", () => {
    const reporter = createOtelReporter();
    if (!reporter) throw new Error("expected a reporter in a server runtime");

    reporter.log(
      logObject({ message: "[90mLatencyTimer: [39m", args: ["{}"] }),
      {} as never,
    );

    expect(emit.mock.calls[0][0].body).not.toContain("");
    expect(emit.mock.calls[0][0].body).toContain("LatencyTimer:");
  });

  it("never throws when the logs API fails", () => {
    emit.mockImplementationOnce(() => {
      throw new Error("exporter down");
    });
    const reporter = createOtelReporter();
    if (!reporter) throw new Error("expected a reporter in a server runtime");

    // Telemetry must not be able to break the request it is describing.
    expect(() =>
      reporter.log(logObject({ args: ["still fine"] }), {} as never),
    ).not.toThrow();
  });
});
