import { createAzureOpenAICompatible } from "./azure-openai-compatible";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { LanguageModel } from "ai";
import { isString } from "lib/utils";
import logger from "logger";
import { z } from "zod";

/**
 * OpenAI-compatible models from an environment variable.
 * @returns An object containing the loaded models and a set of models
 *          that do not support tool calls.
 */
export function createOpenAICompatibleModels(
  config: OpenAICompatibleProvider[],
) {
  const providers: Record<string, Record<string, LanguageModel>> = {};
  const unsupportedModels = new Set<LanguageModel>();

  if (!config?.length) {
    return { providers, unsupportedModels };
  }
  try {
    config.forEach(({ provider, models, baseUrl, apiKey }) => {
      const providerKey = provider;
      const customProvider = createOpenAICompatible({
        name: provider,
        apiKey: apiKey,
        baseURL: baseUrl!,
      });

      providers[providerKey] = {};

      if (provider === "Azure OpenAI") {
        // Handle Azure OpenAI with specific requirements (new addition)
        const azureProvider = createAzureOpenAICompatible({
          name: provider,
          apiKey: apiKey,
          baseURL: baseUrl!,
        });

        models.forEach(
          ({ apiName, uiName, supportsTools, apiVersion: modelApiVersion }) => {
            if (!modelApiVersion) {
              throw new Error(
                `API version is required for Azure OpenAI model: ${uiName}`,
              );
            }
            const model = azureProvider(apiName, modelApiVersion);
            providers[providerKey][uiName] = model;

            if (!supportsTools) {
              unsupportedModels.add(model);
            }
          },
        );
      } else {
        // Standard OpenAI-compatible providers (original implementation)
        models.forEach(({ apiName, uiName, supportsTools }) => {
          const model = customProvider(apiName);
          providers[providerKey][uiName] = model;

          if (!supportsTools) {
            unsupportedModels.add(model);
          }
        });
      }
    });
  } catch (error) {
    console.error("Failed to load or parse dynamic models:", error);
  }

  return { providers, unsupportedModels };
}

// Define the schema for a single AI model that is compatible with OpenAI's API structure.
const OpenAICompatibleModelSchema = z.object({
  apiName: z.string().describe("The internal API name for the model."),
  uiName: z.string().describe("The user-friendly name for the model."),
  // Whether the model supports external tools/function calling, specifically for multi-cloud platform (MCP) servers.
  supportsTools: z
    .boolean()
    .describe(
      "Indicates if the model supports external tools/function calling for multi-cloud platform (MCP) servers.",
    ),
  apiVersion: z
    .string()
    .optional()
    .describe(
      "For Azure OpenAI, the API version for this specific model. Required for Azure OpenAI models.",
    ),
});

// Define the schema for a provider that is compatible with OpenAI's API structure,
// which includes a list of its OpenAI-compatible models.
export const OpenAICompatibleProviderSchema = z.object({
  provider: z.string().describe("Your api key"),
  models: z
    .array(OpenAICompatibleModelSchema)
    .describe("A list of AI models offered by this provider."),
  // The environment variable name for the provider's API key. Stored in .env.
  apiKey: z
    .string()
    .describe(
      "The name of the environment variable (e.g., 'OPENAI_API_KEY') for the provider's API key. This key should be stored in a .env file.",
    ),
  // The base URL for the provider's API. Defaults to the provider's default API endpoint. Should be OpenAI-like.
  baseUrl: z
    .string()
    .url()
    .optional()
    .describe(
      "The base URL for the provider's API. Defaults to the provider's official endpoint. Should typically follow an OpenAI-like structure (e.g., ending with '/v1').",
    ),
});

// Infer the type for a single OpenAI-compatible provider.
export type OpenAICompatibleProvider = z.infer<
  typeof OpenAICompatibleProviderSchema
>;

export const openaiCompatibleModelsSafeParse = (
  providers: string | OpenAICompatibleProvider[] = [],
) => {
  try {
    const value = isString(providers) ? JSON.parse(providers) : providers;
    return z.array(OpenAICompatibleProviderSchema).parse(value);
  } catch (error) {
    logger.error(error);
    return [];
  }
};
