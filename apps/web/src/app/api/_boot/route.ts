import { type NextRequest } from "next/server";
import { z } from "zod";

const BOOT_VISIT_COOKIE = "__boot_visit";
const MAX_BODY_BYTES = 8_192;

const bootEventSchema = z
  .object({
    event: z.enum([
      "anchor-click",
      "beforeunload",
      "chatbot-mount",
      "chatbot-unmount",
      "client-boot",
      "error",
      "pagehide",
      "pageshow",
      "popstate",
      "react-mount",
      "react-unmount",
      "unhandledrejection",
      "visibilitychange",
    ]),
    visitId: z.uuid(),
    documentId: z.uuid(),
    tabId: z.uuid(),
    documentSequence: z.number().int().positive().max(10_000),
    at: z.iso.datetime(),
    elapsedMs: z.number().int().nonnegative().max(86_400_000),
    path: z.string().startsWith("/").max(300),
    navigationType: z.string().max(30),
    details: z.record(z.string(), z.unknown()),
  })
  .strict();

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (process.env.BOOT_DIAGNOSTICS !== "1") {
    return new Response(null, { status: 404 });
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") {
    return new Response(null, { status: 403 });
  }

  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    return new Response(null, { status: 415 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) {
    return new Response(null, { status: 413 });
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return new Response(null, { status: 413 });
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }

  const result = bootEventSchema.safeParse(json);
  if (!result.success) {
    return new Response(null, { status: 400 });
  }

  const cookieVisitId = request.cookies.get(BOOT_VISIT_COOKIE)?.value;
  if (!cookieVisitId || cookieVisitId !== result.data.visitId) {
    return new Response(null, { status: 403 });
  }

  console.info("[boot] client", result.data);
  return new Response(null, {
    headers: { "cache-control": "no-store" },
    status: 204,
  });
}
