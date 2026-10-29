import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/**
 * Create an Azure OpenAI compatible provider that handles the specific API requirements
 * of Azure's implementation
 */
export function createAzureOpenAICompatible({
  name,
  apiKey,
  baseURL,
}: {
  name: string;
  apiKey: string;
  baseURL: string;
}) {
  // Return a function that creates models with the correct Azure URL structure
  return (modelName: string, modelApiVersion: string) => {
    // Use the model-specific API version (required)
    const effectiveApiVersion = modelApiVersion;

    // For Azure OpenAI, construct the full URL including the deployment name
    const azureBaseURL = `${baseURL}${modelName}`;

    // Custom fetch implementation for Azure OpenAI
    const customFetch = async (
      input: URL | RequestInfo,
      init?: RequestInit,
    ): Promise<Response> => {
      let url = input.toString();

      // If the URL doesn't already have an API version, append it as query parameter
      if (!url.includes("api-version=")) {
        const separator = url.includes("?") ? "&" : "?";
        url = `${url}${separator}api-version=${effectiveApiVersion}`;
      }

      // Set the correct authentication header
      const headers = {
        ...(init?.headers || {}),
        "api-key": apiKey,
      };

      // Remove any Authorization header if present
      if (headers["Authorization"]) {
        delete headers["Authorization"];
      }

      return fetch(url, {
        ...init,
        headers,
      });
    };

    // Create the OpenAI compatible client with our custom fetch
    const provider = createOpenAICompatible({
      name,
      apiKey,
      baseURL: azureBaseURL,
      fetch: customFetch,
    });

    // Return the model (note: we pass an empty string since we already included the model in baseURL)
    return provider("");
  };
}
