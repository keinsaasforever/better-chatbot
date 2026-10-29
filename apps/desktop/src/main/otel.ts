/**
 * Opt-in OpenTelemetry for the Electron main process.
 *
 * This code runs on end users' machines, so it is **off unless explicitly
 * enabled** with `KEINSAAS_DESKTOP_TELEMETRY=1`. Unlike the server, there is no
 * operational contract that justifies collecting by default.
 *
 * The value it adds when enabled is the set of failures web telemetry can never
 * see: main-process crashes, local stdio MCP spawn failures, and keychain /
 * filesystem errors on the user's own machine.
 *
 * No traces of user content: only process lifecycle and error shape.
 */
import { logs } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { NodeSDK } from "@opentelemetry/sdk-node";

const SUPERLOG_ENDPOINT = "https://intake.superlog.sh";
const SUPERLOG_PUBLIC_TOKEN = process.env.SUPERLOG_PUBLIC_TOKEN?.trim() ?? "";
const SERVICE_NAME = "keinsaas-desktop";

const isEnabled =
  process.env.KEINSAAS_DESKTOP_TELEMETRY === "1" &&
  ["sl_public_", "superlog_live_"].some((prefix) =>
    SUPERLOG_PUBLIC_TOKEN.startsWith(prefix),
  );

const headers = { "x-api-key": SUPERLOG_PUBLIC_TOKEN };

let sdk: NodeSDK | undefined;

export function initDesktopTelemetry(appVersion: string): void {
  if (!isEnabled || sdk) return;

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      "service.name": SERVICE_NAME,
      "service.version": appVersion,
      "deployment.environment.name": "desktop",
      "vcs.repository.url.full":
        "https://github.com/keinsaasforever/keinsaas-navigator",
    }),
    traceExporter: new OTLPTraceExporter({
      url: `${SUPERLOG_ENDPOINT}/v1/traces`,
      headers,
    }),
    logRecordProcessors: [
      new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({
          url: `${SUPERLOG_ENDPOINT}/v1/logs`,
          headers,
        }),
      }),
    ],
  });

  sdk.start();
}

/**
 * Flush pending telemetry before the app exits. Desktop sessions end abruptly;
 * without this the batch holding the crash that ended the session is lost.
 */
export async function shutdownDesktopTelemetry(): Promise<void> {
  if (!sdk) return;
  await sdk.shutdown().catch(() => undefined);
}

/**
 * Records a main-process error. No-ops entirely when telemetry is off, so call
 * sites do not need their own guard.
 */
export function recordDesktopError(
  operation: string,
  error: unknown,
  attributes?: Record<string, string | number | boolean>,
): void {
  if (!isEnabled) return;
  logs.getLogger(SERVICE_NAME).emit({
    severityNumber: 17,
    severityText: "ERROR",
    body: `${operation} failed`,
    attributes: {
      "app.operation": operation,
      ...(error instanceof Error
        ? {
            "exception.type": error.name,
            "exception.message": error.message,
          }
        : { "exception.message": String(error) }),
      ...attributes,
    },
  });
}
