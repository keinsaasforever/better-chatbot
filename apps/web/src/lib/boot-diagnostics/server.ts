import "server-only";

import { headers } from "next/headers";

export async function logBootServerRender(route: string) {
  if (process.env.BOOT_DIAGNOSTICS !== "1") return;

  const requestHeaders = await headers();
  if (requestHeaders.get("sec-fetch-dest") !== "document") return;

  const visitId = requestHeaders.get("x-boot-visit-id");
  const documentId = requestHeaders.get("x-boot-document-id");
  if (!visitId || !documentId) return;

  console.info("[boot] server-render", {
    event: "server-render",
    at: new Date().toISOString(),
    visitId,
    documentId,
    route,
    rsc: requestHeaders.get("rsc") === "1",
    routerPrefetch: requestHeaders.get("next-router-prefetch") === "1",
  });
}
