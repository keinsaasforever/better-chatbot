import { Sandbox } from "@e2b/code-interpreter";
import { getSession } from "auth/server";
import { mimeTypeForFile } from "lib/e2b/artifact-files";
import { errorLabel, toSandboxErrorResponse } from "lib/e2b/create-sandbox";
import logger from "lib/logger";
import { NextResponse } from "next/server";

export const maxDuration = 60;

/** Per-download size cap. */
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;

/**
 * Download a file from a running sandbox, e.g. a PDF generated inside a live
 * web preview. The server proxies the read through the SDK so it works for
 * both secure and insecure sandboxes and the E2B key never reaches the client.
 *
 * GET /api/sandbox/:sbxId/files?path=/home/user/report.pdf
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ sbxId: string }> },
) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.E2B_API_KEY) {
    return NextResponse.json(
      { error: "E2B_API_KEY is not configured" },
      { status: 500 },
    );
  }

  const { sbxId } = await params;
  const path = new URL(req.url).searchParams.get("path");
  if (!path || path.includes("..")) {
    return NextResponse.json(
      { error: "A valid absolute file path is required" },
      { status: 400 },
    );
  }

  try {
    const sbx = await Sandbox.connect(sbxId, {
      apiKey: process.env.E2B_API_KEY,
    });

    // Only the user who created the sandbox may read from it. The key is
    // `billingUserId` — that is what createSandbox writes into metadata.
    // Reading a `userID` key that is never written made this compare
    // undefined !== id and 403 every download.
    const info = await sbx.getInfo();
    if (info.metadata?.billingUserId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const bytes = await sbx.files.read(path, { format: "bytes" });
    if (bytes.byteLength > MAX_DOWNLOAD_BYTES) {
      return NextResponse.json(
        { error: "File exceeds the 50MB download limit" },
        { status: 413 },
      );
    }

    const filename = path.split("/").pop() || "download";
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": mimeTypeForFile(filename),
        "Content-Disposition": `attachment; filename="${filename.replaceAll('"', "")}"`,
        "Content-Length": String(bytes.byteLength),
      },
    });
  } catch (err) {
    // A missing file/sandbox should read as 404, not the generic template error.
    if (err instanceof Error && err.name.includes("NotFound")) {
      return NextResponse.json(
        { error: "File or sandbox not found (it may have expired)" },
        { status: 404 },
      );
    }
    const mapped = toSandboxErrorResponse(err);
    logger.warn(
      `[e2b] file download failed sbxId=${sbxId} path=${path} error=${errorLabel(err)}`,
    );
    return NextResponse.json(
      { error: mapped.message, code: mapped.code },
      { status: mapped.status },
    );
  }
}
