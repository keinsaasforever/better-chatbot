import { randomUUID } from "node:crypto";
import type { Sandbox } from "@e2b/code-interpreter";
import {
  type CollectedArtifact,
  collectGeneratedFiles,
  snapshotWorkdir,
} from "lib/e2b/artifact-files";
import {
  EXEC_SANDBOX_TIMEOUT_MS,
  type SandboxBillingContext,
  createSandbox,
  errorLabel,
  isTemplateNotFound,
  toSandboxErrorResponse,
} from "lib/e2b/create-sandbox";
import {
  STOCK_EXECUTION_TEMPLATE_ID,
  getExecutionTemplateId,
} from "lib/e2b/sandbox-registry";
import { serverFileStorage } from "lib/file-storage";
import logger from "lib/logger";
import { formatBytes } from "lib/utils";
import { INTERACTIVE_EXECUTION_TIMEOUT_MS } from "./timeouts";
import type {
  CodeRunnerResult,
  E2BArtifact,
  LogEntry,
} from "./code-runner.interface";

const DEFAULT_EXECUTION_TIMEOUT_MS = INTERACTIVE_EXECUTION_TIMEOUT_MS;

/**
 * Above this, a failed upload yields an `error` entry instead of an inline
 * base64 fallback. The fallback rides in the tool-call HTTP response, which
 * has its own size cap; a multi-megabyte blob there would fail the whole run
 * rather than just the one file.
 */
export const INLINE_FALLBACK_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Upload each artifact's bytes to durable storage and swap in a permanent URL,
 * so downloads survive a page refresh. The returned objects never carry bytes
 * (neither `bytes` nor, past the small fallback, `contentBase64`): they are
 * JSON-serialised into the tool-call response and the message row.
 *
 * Artifacts go to the private attachments bucket and are served through the
 * authenticated `/api/storage/download` route: bucket public URLs and signed
 * URLs both break after persistence (private bucket / expiry), while the app
 * route stays valid for as long as the object exists and redirects to a fresh
 * signed URL per click.
 */
export async function persistArtifacts(
  artifacts: CollectedArtifact[],
  userId?: string,
): Promise<E2BArtifact[]> {
  return Promise.all(
    artifacts.map(async (artifact): Promise<E2BArtifact> => {
      const { bytes, contentBase64, ...rest } = artifact;
      const body =
        bytes ??
        (contentBase64 ? Buffer.from(contentBase64, "base64") : undefined);
      // Already persisted, or metadata-only (too large — see the collector).
      if (!body) return rest;

      const sizeBytes = rest.sizeBytes ?? body.byteLength;
      // View, not copy: a 50 MiB artifact should not be duplicated in memory.
      const buffer = Buffer.isBuffer(body)
        ? body
        : Buffer.from(body.buffer, body.byteOffset, body.byteLength);
      try {
        const { key } = await serverFileStorage.upload(buffer, {
          contentType: rest.mimeType,
          filename: rest.filename,
          userId,
          uploadType: "attachment",
        });
        return {
          filename: rest.filename,
          mimeType: rest.mimeType,
          sizeBytes,
          url: `/api/storage/download?key=${encodeURIComponent(key)}`,
        };
      } catch (err) {
        logger.warn(
          `[e2b] artifact upload failed file=${rest.filename} size=${sizeBytes} error=${errorLabel(err)}`,
        );
        // A small file still reaches the user inline; a big one is named with
        // the reason so the chat and the model can say what happened.
        if (sizeBytes <= INLINE_FALLBACK_MAX_BYTES) {
          return {
            filename: rest.filename,
            mimeType: rest.mimeType,
            sizeBytes,
            contentBase64: buffer.toString("base64"),
          };
        }
        return {
          filename: rest.filename,
          mimeType: rest.mimeType,
          sizeBytes,
          error: "upload failed",
        };
      }
    }),
  );
}

export type E2BRunResult = CodeRunnerResult & {
  artifacts?: E2BArtifact[];
  sbxId?: string;
};

/**
 * Render an execution error for the model, adding the recovery step when the
 * error has an obvious one.
 *
 * A bare `ModuleNotFoundError` is the single most common way a PDF request
 * failed in production: the model reads the tool result and, with nothing but
 * the exception name, tends to re-run the same import rather than install the
 * package. Each run is a fresh sandbox, so the install has to be in the same
 * block as the import — which is what this says.
 */
export function describeExecutionError(error: {
  name: string;
  value?: unknown;
}): string {
  const base = `${error.name}: ${error.value}`;
  if (error.name !== "ModuleNotFoundError") return base;

  const moduleName = /No module named '([^']+)'/.exec(String(error.value))?.[1];
  if (!moduleName) return base;

  return `${base}\nThe sandbox does not have this package. Install it in the SAME code block as the import, before using it: !pip install -q ${moduleName}`;
}

/** A file to write into the sandbox working directory before the code runs. */
export type E2BStagedFile = { filename: string; bytes: Buffer };

/** Working directory the interpreter template runs in; also where files land. */
const SANDBOX_WORKDIR = "/home/user";

/**
 * Start an execution sandbox, falling back to the stock interpreter when the
 * configured template does not exist in the E2B account.
 *
 * `E2B_EXECUTION_TEMPLATE` names a template without proving it was ever built,
 * so a value that is merely aspirational — or mistyped — used to fail every
 * Python *and* JavaScript run with "Failed to start the sandbox", since both
 * resolve the same id. Degrading to `code-interpreter-v1` costs the
 * preinstalled document libraries (the model is told to pip install when they
 * are absent, and `describeExecutionError` repeats that on a
 * ModuleNotFoundError), which beats executing nothing at all.
 *
 * Logged at error level, not warn: nothing about this is normal, and the log
 * line is the only thing that will tell an operator their env var points at
 * an image that does not exist.
 */
async function createExecutionSandbox(
  template: string,
  apiKey: string,
  billing: SandboxBillingContext,
): Promise<Sandbox> {
  try {
    return await createSandbox(template, {
      apiKey,
      timeoutMs: EXEC_SANDBOX_TIMEOUT_MS,
      billing,
      requestId: randomUUID(),
    });
  } catch (err) {
    if (!isTemplateNotFound(err) || template === STOCK_EXECUTION_TEMPLATE_ID) {
      throw err;
    }
    logger.error(
      `[e2b] template=${template} does not exist in this E2B account; falling back to ${STOCK_EXECUTION_TEMPLATE_ID}. Build it or unset E2B_EXECUTION_TEMPLATE. error=${errorLabel(err)}`,
    );
    return createSandbox(STOCK_EXECUTION_TEMPLATE_ID, {
      apiKey,
      timeoutMs: EXEC_SANDBOX_TIMEOUT_MS,
      billing,
      requestId: randomUUID(),
    });
  }
}

export async function e2bRun(
  code: string,
  type: "javascript" | "python",
  billing: SandboxBillingContext,
  timeout = DEFAULT_EXECUTION_TIMEOUT_MS,
  files: E2BStagedFile[] = [],
): Promise<E2BRunResult> {
  const startTime = Date.now();
  const logs: LogEntry[] = [];

  const apiKey = process.env.E2B_API_KEY;
  if (!apiKey) {
    return {
      success: false,
      logs: [],
      error: "E2B_API_KEY is not configured",
      backend: "e2b",
    };
  }

  const template = getExecutionTemplateId();

  let sbx: Sandbox;
  try {
    sbx = await createExecutionSandbox(template, apiKey, billing);
  } catch (err) {
    logger.error(`[e2b] exec sandbox create failed error=${errorLabel(err)}`);
    return {
      success: false,
      logs: [],
      error: toSandboxErrorResponse(err, template).message,
      backend: "e2b",
    };
  }

  const stagedFiles = await stageFiles(sbx, files, logs);

  try {
    // Snapshot the working directory so files written by the code (PDFs,
    // CSVs, images, …) can be detected and returned as artifacts. Taken after
    // staging so pre-loaded attachments are not misreported as generated.
    const workdirBefore = await snapshotWorkdir(sbx);

    const {
      logs: execLogs,
      error,
      results,
    } = await sbx.runCode(code, {
      language: type === "javascript" ? "js" : "python",
      timeoutMs: timeout,
    });

    for (const line of execLogs.stdout) {
      logs.push({ type: "log", args: [{ type: "data", value: line }] });
    }
    for (const line of execLogs.stderr) {
      logs.push({ type: "error", args: [{ type: "data", value: line }] });
    }

    const artifacts: CollectedArtifact[] = [];
    for (const result of results) {
      if (result.png) {
        const dataUri = `data:image/png;base64,${result.png}`;
        logs.push({
          type: "log",
          args: [{ type: "image", value: dataUri }],
        });
        const png = Buffer.from(result.png, "base64");
        artifacts.push({
          filename: "output.png",
          mimeType: "image/png",
          sizeBytes: png.byteLength,
          bytes: png,
        });
      }
      if (result.text) {
        logs.push({
          type: "log",
          args: [{ type: "data", value: result.text }],
        });
      }
      if (result.html) {
        const html = Buffer.from(result.html);
        artifacts.push({
          filename: "output.html",
          mimeType: "text/html",
          sizeBytes: html.byteLength,
          bytes: html,
        });
      }
      if (result.pdf) {
        const pdf = Buffer.from(result.pdf, "base64");
        artifacts.push({
          filename: "output.pdf",
          mimeType: "application/pdf",
          sizeBytes: pdf.byteLength,
          bytes: pdf,
        });
      }
    }

    // Files written to the working directory (e.g. doc.output('report.pdf'),
    // df.to_csv('data.csv'), plt.savefig('chart.pdf')) become artifacts too.
    const generatedFiles = await collectGeneratedFiles(sbx, workdirBefore);
    for (const file of generatedFiles) {
      artifacts.push(file);
      logs.push({
        type: "log",
        args: [
          {
            type: "data",
            value: file.error
              ? `Generated file not delivered: ${file.filename} (${file.error})`
              : `Generated file: ${file.filename} (${file.mimeType}, ${formatBytes(file.sizeBytes ?? 0, 1)})`,
          },
        ],
      });
    }

    // Upload artifacts to durable storage so their download links persist.
    const durableArtifacts =
      artifacts.length > 0
        ? await persistArtifacts(artifacts, billing.userId)
        : [];

    // Code that raised is a normal outcome here, not a thrown error — so it
    // never reached the logger below and the failure was invisible in
    // production. Log it (as a warning: user code failing is expected).
    if (error) {
      logger.warn(
        `[e2b] exec code error type=${type} sbx=${sbx.sandboxId} error=${
          error.name
        }: ${String(error.value ?? "").slice(0, 500)} ms=${Date.now() - startTime}`,
      );
    }

    return {
      success: !error,
      logs,
      error: error ? describeExecutionError(error) : undefined,
      executionTimeMs: Date.now() - startTime,
      artifacts: durableArtifacts.length > 0 ? durableArtifacts : undefined,
      sbxId: sbx.sandboxId,
      backend: "e2b",
      stagedFiles: stagedFiles.length > 0 ? stagedFiles : undefined,
    };
  } catch (err) {
    logger.error(`[e2b] exec sandbox run failed error=${errorLabel(err)}`);
    return {
      success: false,
      logs,
      error: errorLabel(err),
      executionTimeMs: Date.now() - startTime,
      sbxId: sbx.sandboxId,
      backend: "e2b",
      stagedFiles: stagedFiles.length > 0 ? stagedFiles : undefined,
    };
  } finally {
    await sbx.kill().catch(() => {});
  }
}

/**
 * Write staged attachments into the sandbox working directory before the user
 * code runs, so `pd.read_csv('data.csv')` finds the file the user uploaded.
 * Best-effort: a file that fails to write is logged and skipped rather than
 * aborting the run. Returns the filenames that were written and records a
 * diagnostic log line in the tool result.
 */
export async function stageFiles(
  sbx: Sandbox,
  files: E2BStagedFile[],
  logs: LogEntry[],
): Promise<string[]> {
  const staged: string[] = [];
  for (const file of files) {
    try {
      // The SDK accepts ArrayBuffer, not a Node Buffer/Uint8Array view — copy
      // into a standalone ArrayBuffer so no unrelated pool memory is exposed.
      const bytes = new Uint8Array(file.bytes.byteLength);
      bytes.set(file.bytes);
      await sbx.files.write(
        `${SANDBOX_WORKDIR}/${file.filename}`,
        bytes.buffer,
      );
      staged.push(file.filename);
    } catch (err) {
      logger.warn(
        `[e2b] stage attachment write failed file=${file.filename} error=${errorLabel(err)}`,
      );
    }
  }
  if (staged.length > 0) {
    logs.push({
      type: "log",
      args: [
        {
          type: "data",
          value: `Staged attachment${staged.length > 1 ? "s" : ""} in ${SANDBOX_WORKDIR}: ${staged.join(", ")}`,
        },
      ],
    });
  }
  return staged;
}
