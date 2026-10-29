import "server-only";

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const tensorx = createOpenAICompatible({
  name: "tensorx",
  baseURL: process.env.TENSORX_BASE_URL?.trim() || "https://api.tensorx.ai/v1",
  apiKey: process.env.TENSORX_API_KEY || "not-configured",
});

export function getTensorXModel(providerModelId: string) {
  if (!process.env.TENSORX_API_KEY || process.env.TENSORX_API_KEY === "****") {
    throw new Error("TensorX is not configured");
  }
  return tensorx(providerModelId);
}
