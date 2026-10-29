/**
 * Which edition of the product this build is.
 *
 * `cloud` is the hosted keinsaas Navigator: team management, billing and the
 * paid entitlements are part of the product. `community` is the open-source
 * self-hosted edition, where those surfaces do not exist.
 *
 * Read from a NEXT_PUBLIC_ variable so the same constant is available to
 * server and client components; it is inlined at build time.
 */
export const EDITION =
  process.env.NEXT_PUBLIC_EDITION === "cloud" ? "cloud" : "community";

export const IS_CLOUD_EDITION = EDITION === "cloud";
