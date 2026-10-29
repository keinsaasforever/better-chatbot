export type SandboxDeploymentPhase =
  | "generating_code"
  | "starting_sandbox"
  | "installing"
  | "checking_preview"
  | "ready"
  | "failed";

export interface SandboxApiResponse {
  requestId: string;
  phase: SandboxDeploymentPhase;
  code: string;
  retryable: boolean;
  failedPhase?: Exclude<SandboxDeploymentPhase, "failed" | "ready">;
  error?: string;
  url?: string;
  sbxId?: string;
  template?: string;
  ready?: boolean;
  warning?: string;
}

export interface SandboxDeploymentState extends SandboxApiResponse {
  syncError?: string;
}

export const SANDBOX_BROWSER_TIMEOUT_MS = 180_000;

export function isSandboxApiResponse(
  value: unknown,
): value is SandboxApiResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Record<string, unknown>;
  return (
    typeof response.requestId === "string" &&
    typeof response.phase === "string" &&
    typeof response.code === "string" &&
    typeof response.retryable === "boolean"
  );
}
