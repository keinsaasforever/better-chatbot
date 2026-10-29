import "server-only";
import { Kernel } from "@onkernel/sdk";

/**
 * Kernel API client.
 *
 * `server-only`: `KERNEL_API_KEY` must never reach the browser bundle. The tool
 * that uses this runs its `execute` on the server, and the only thing that ever
 * travels to the client is the live-view URL.
 */
let kernelInstance: Kernel | null = null;

/**
 * Whether Kernel is configured at all. The browser tool is dropped from the
 * toolkit when this is false, the same way the E2B tool depends on its own
 * template registry — a tool that cannot possibly succeed should not be offered
 * to the model.
 */
export const IS_KERNEL_CONFIGURED = Boolean(process.env.KERNEL_API_KEY);

export function getKernelClient(): Kernel {
  const apiKey = process.env.KERNEL_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Kernel is not configured. Set KERNEL_API_KEY to enable browser automation.",
    );
  }
  kernelInstance ??= new Kernel({ apiKey });
  return kernelInstance;
}

/**
 * Resets the client singleton. Test-only, mirroring `resetAutumnClient()`.
 *
 * @internal
 */
export function resetKernelClient(): void {
  kernelInstance = null;
}
