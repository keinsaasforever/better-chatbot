import type { Tool } from "ai";

export function resolveToolDescription(
  description: Tool["description"],
): string {
  return typeof description === "string" ? description : "";
}
