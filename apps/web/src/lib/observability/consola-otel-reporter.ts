/**
 * Bridges consola output into OpenTelemetry log records.
 *
 * The app logs through a single consola instance (`lib/logger.ts`, imported via
 * the `logger` path alias in dozens of modules). Attaching one reporter here
 * gets every existing `logger.info(...)` / `logger.error(...)` call into
 * Superlog — with `trace_id` / `span_id` filled in automatically whenever the
 * call happens inside a span — without touching a single call site.
 *
 * stdout output is left intact. Superlog coexists with the incumbent; Vercel
 * logs stay exactly as useful as they are today.
 */
import type { AnyValue, LogAttributes, Logger } from "@opentelemetry/api-logs";
import { SeverityNumber, logs } from "@opentelemetry/api-logs";
import type { ConsolaReporter, LogObject } from "consola";

const SEVERITY_BY_TYPE: Record<string, SeverityNumber> = {
  fatal: SeverityNumber.FATAL,
  error: SeverityNumber.ERROR,
  fail: SeverityNumber.ERROR,
  warn: SeverityNumber.WARN,
  debug: SeverityNumber.DEBUG,
  trace: SeverityNumber.TRACE,
  verbose: SeverityNumber.TRACE,
};

const severityFor = (type: string): SeverityNumber =>
  SEVERITY_BY_TYPE[type] ?? SeverityNumber.INFO;

const severityTextFor = (severity: SeverityNumber): string => {
  if (severity >= SeverityNumber.FATAL) return "FATAL";
  if (severity >= SeverityNumber.ERROR) return "ERROR";
  if (severity >= SeverityNumber.WARN) return "WARN";
  if (severity >= SeverityNumber.INFO) return "INFO";
  if (severity >= SeverityNumber.DEBUG) return "DEBUG";
  return "TRACE";
};

/**
 * ANSI escapes from `consola/utils` `colorize` are useful in a terminal and pure
 * noise in a log backend — they also defeat grouping, since the same message
 * with different colours fingerprints differently.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escapes
const ANSI_PATTERN = /\[[0-9;]*m/g;
const stripAnsi = (value: string): string => value.replace(ANSI_PATTERN, "");

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Splits consola args into a human-readable body and structured attributes.
 *
 * Callers in this codebase log in two shapes — `logger.info("text", obj)` and
 * `logger.error(err)` — and both should survive the trip. Plain objects become
 * attributes so they stay queryable; everything else is folded into the body.
 */
const buildRecord = (
  logObj: LogObject,
): { body: string; attributes: LogAttributes } => {
  const bodyParts: string[] = [];
  const attributes: LogAttributes = {};

  if (typeof logObj.message === "string" && logObj.message.length > 0) {
    bodyParts.push(stripAnsi(logObj.message));
  }

  for (const arg of logObj.args ?? []) {
    if (typeof arg === "string") {
      bodyParts.push(stripAnsi(arg));
      continue;
    }
    if (arg instanceof Error) {
      bodyParts.push(arg.message);
      attributes["exception.type"] = arg.name;
      attributes["exception.message"] = arg.message;
      if (arg.stack) attributes["exception.stacktrace"] = arg.stack;
      continue;
    }
    if (isPlainObject(arg)) {
      for (const [key, value] of Object.entries(arg)) {
        // Log attributes must be scalars (or arrays of scalars); anything else
        // is serialized rather than silently dropped by the exporter.
        attributes[key] =
          value === null ||
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean"
            ? (value as AnyValue)
            : safeStringify(value);
      }
      continue;
    }
    bodyParts.push(String(arg));
  }

  return { body: bodyParts.join(" ").trim(), attributes };
};

const safeStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

/**
 * Creates the reporter. Returns `null` on anything that is not a server
 * runtime — the OTel logs API is server-side here, and PostHog already covers
 * the browser.
 */
export function createOtelReporter(): ConsolaReporter | null {
  if (typeof window !== "undefined") return null;

  // Resolved lazily: the global logger provider is installed by
  // `registerObservability()`, which may run after this module is first
  // imported. `logs.getLogger()` is a no-op until then, so an early call would
  // permanently capture a no-op logger.
  let cached: Logger | undefined;
  const getLogger = (): Logger => {
    cached ??= logs.getLogger("keinsaas-navigator", "1.0.0");
    return cached;
  };

  return {
    log(logObj: LogObject) {
      try {
        const severityNumber = severityFor(logObj.type);
        const { body, attributes } = buildRecord(logObj);
        if (logObj.tag) attributes["log.tag"] = logObj.tag;
        attributes["log.type"] = logObj.type;

        getLogger().emit({
          severityNumber,
          severityText: severityTextFor(severityNumber),
          body,
          attributes,
        });
      } catch {
        // Telemetry must never break the request it is describing. Swallowing
        // here also prevents a loop: reporting this failure through consola
        // would re-enter this same reporter.
      }
    },
  };
}
