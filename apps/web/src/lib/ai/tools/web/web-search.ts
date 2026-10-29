import { tool as createTool } from "ai";
import { JSONSchema7 } from "json-schema";
import { jsonSchemaToZod } from "lib/json-schema-to-zod";
import { safe } from "ts-safe";
// Import the billing gate only at execution time to avoid bundling server-only code in client
import { fetchExaWithRetry, getExaKeyCount } from "./exa-key-rotation";

// Exa API Types
export interface ExaSearchRequest {
  query: string;
  type: string;
  category?: string;
  includeDomains?: string[];
  excludeDomains?: string[];
  startPublishedDate?: string;
  endPublishedDate?: string;
  numResults: number;
  contents: {
    text:
      | {
          maxCharacters?: number;
        }
      | boolean;
    livecrawl?: "always" | "fallback" | "preferred";
    subpages?: number;
    subpageTarget?: string[];
  };
}

export interface ExaSearchResult {
  id: string;
  title: string;
  url: string;
  publishedDate: string;
  author: string;
  text: string;
  image?: string;
  favicon?: string;
  score?: number;
}

export interface ExaSearchResponse {
  requestId: string;
  autopromptString: string;
  resolvedSearchType: string;
  results: ExaSearchResult[];
}

export interface ExaContentsRequest {
  ids: string[];
  contents: {
    text:
      | {
          maxCharacters?: number;
        }
      | boolean;
    livecrawl?: "always" | "fallback" | "preferred";
  };
}

export const exaSearchSchema: JSONSchema7 = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "Search query",
    },
    numResults: {
      type: "number",
      description: "Number of search results to return",
      default: 5,
      minimum: 1,
      maximum: 20,
    },
    type: {
      type: "string",
      enum: ["auto", "keyword", "neural"],
      description:
        "Search type - auto lets Exa decide, keyword for exact matches, neural for semantic search",
      default: "auto",
    },
    category: {
      type: "string",
      enum: [
        "company",
        "research paper",
        "news",
        "linkedin profile",
        "github",
        "tweet",
        "movie",
        "song",
        "personal site",
        "pdf",
      ],
      description: "Category to focus the search on",
    },
    includeDomains: {
      type: "array",
      items: { type: "string" },
      description: "List of domains to specifically include in search results",
      default: [],
    },
    excludeDomains: {
      type: "array",
      items: { type: "string" },
      description:
        "List of domains to specifically exclude from search results",
      default: [],
    },
    startPublishedDate: {
      type: "string",
      description: "Start date for published content (YYYY-MM-DD format)",
    },
    endPublishedDate: {
      type: "string",
      description: "End date for published content (YYYY-MM-DD format)",
    },
    maxCharacters: {
      type: "number",
      description: "Maximum characters to extract from each result",
      default: 3000,
      minimum: 100,
      maximum: 10000,
    },
  },
  required: ["query"],
};

export const exaContentsSchema: JSONSchema7 = {
  type: "object",
  properties: {
    urls: {
      type: "array",
      items: { type: "string" },
      description: "List of URLs to extract content from",
    },
    maxCharacters: {
      type: "number",
      description: "Maximum characters to extract from each URL",
      default: 3000,
      minimum: 100,
      maximum: 10000,
    },
    livecrawl: {
      type: "string",
      enum: ["always", "fallback", "preferred"],
      description:
        "Live crawling preference - always forces live crawl, fallback uses cache first, preferred tries live first",
      default: "preferred",
    },
  },
  required: ["urls"],
};

const BASE_URL = "https://api.exa.ai";

const fetchExa = async (
  endpoint: string,
  body: any,
  customerId?: string,
  toolCallId?: string,
  entityId?: string,
): Promise<any> => {
  // 1. Verify Exa API keys are configured first (fail fast with clear error)
  const keyCount = getExaKeyCount();
  if (keyCount === 0) {
    throw new Error(
      "Exa.ai API key not configured. Please contact support or add EXA_API_KEY to your environment variables.",
    );
  }

  // 2. Check the search entitlement (only if user tracking is enabled)
  if (customerId) {
    const { checkMeteredFeature } = await import("lib/gate/metering");
    const allowed = await checkMeteredFeature("exaai", {
      customerId,
      entityId,
    });

    if (!allowed) {
      throw new Error(
        `Web search limit reached. Please upgrade your plan to continue using web search.`,
      );
    }
  }

  // 3. Execute search with API key rotation + retry on rate limits
  const result = await fetchExaWithRetry(async (apiKey: string) => {
    const response = await fetch(`${BASE_URL}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey, // Rotated API key
      },
      body: JSON.stringify(body),
    });

    if (response.status === 401) {
      throw new Error("Invalid EXA API key");
    }
    if (response.status === 429) {
      throw new Error("Exa API usage limit exceeded");
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Exa API error (${response.status}): ${errorText}`);
    }

    return response.json();
  });

  // 4. Track usage after successful search
  if (customerId) {
    const { trackUsage } = await import("lib/gate/metering");
    await trackUsage({
      kind: "exa",
      customerId,
      entityId,
      // Per-invocation key so a retried onFinish/tool call is billed once.
      // toolCallId is unique per invocation (repeat identical searches still
      // bill separately); fall back to endpoint+query only if it is missing.
      idempotencyKey: toolCallId
        ? `exa-${customerId}-${toolCallId}`
        : `exa-${customerId}-${endpoint}-${body.query ?? body.ids?.join(",") ?? ""}`,
      properties: {
        endpoint,
        query: body.query || "content_extraction",
        numResults: body.numResults || body.ids?.length || 0,
        keyCount: getExaKeyCount(), // Log how many keys are in rotation
      },
    }).catch((err) => {
      console.error("Failed to track Exa usage:", err);
    });
  }

  return result;
};

export const exaSearchToolForWorkflow = createTool({
  description:
    "Search the web using Exa AI - performs real-time web searches with semantic and neural search capabilities. Returns high-quality, relevant results with full content extraction.",
  inputSchema: jsonSchemaToZod(exaSearchSchema),
  execute: async (params, _context) => {
    const searchRequest: ExaSearchRequest = {
      query: params.query,
      type: params.type || "auto",
      numResults: params.numResults || 5,
      contents: {
        text: {
          maxCharacters: params.maxCharacters || 3000,
        },
        livecrawl: "preferred",
      },
    };

    // Add optional parameters if provided
    if (params.category) searchRequest.category = params.category;
    if (params.includeDomains?.length)
      searchRequest.includeDomains = params.includeDomains;
    if (params.excludeDomains?.length)
      searchRequest.excludeDomains = params.excludeDomains;
    if (params.startPublishedDate)
      searchRequest.startPublishedDate = params.startPublishedDate;
    if (params.endPublishedDate)
      searchRequest.endPublishedDate = params.endPublishedDate;

    return fetchExa("/search", searchRequest, undefined); // userId not available in workflow context
  },
});

export const exaContentsToolForWorkflow = createTool({
  description:
    "Extract detailed content from specific URLs using Exa AI - retrieves full text content, metadata, and structured information from web pages with live crawling capabilities.",
  inputSchema: jsonSchemaToZod(exaContentsSchema),
  execute: async (params, _context) => {
    const contentsRequest: ExaContentsRequest = {
      ids: params.urls,
      contents: {
        text: {
          maxCharacters: params.maxCharacters || 3000,
        },
        livecrawl: params.livecrawl || "preferred",
      },
    };

    return fetchExa("/contents", contentsRequest, undefined); // userId not available in workflow context
  },
});

// Factory function to create Exa search tool with userId bound
export const createExaSearchTool = (customerId?: string, entityId?: string) =>
  createTool({
    description:
      "Search the web using Exa AI - performs real-time web searches with semantic and neural search capabilities. Returns high-quality, relevant results with full content extraction.",
    inputSchema: jsonSchemaToZod(exaSearchSchema),
    execute: (params, { toolCallId }) => {
      return safe(async () => {
        const searchRequest: ExaSearchRequest = {
          query: params.query,
          type: params.type || "auto",
          numResults: params.numResults || 5,
          contents: {
            text: {
              maxCharacters: params.maxCharacters || 3000,
            },
            livecrawl: "preferred",
          },
        };

        // Add optional parameters if provided
        if (params.category) searchRequest.category = params.category;
        if (params.includeDomains?.length)
          searchRequest.includeDomains = params.includeDomains;
        if (params.excludeDomains?.length)
          searchRequest.excludeDomains = params.excludeDomains;
        if (params.startPublishedDate)
          searchRequest.startPublishedDate = params.startPublishedDate;
        if (params.endPublishedDate)
          searchRequest.endPublishedDate = params.endPublishedDate;

        const result = await fetchExa(
          "/search",
          searchRequest,
          customerId,
          toolCallId,
          entityId,
        );

        return {
          ...result,
          guide: `Use the search results to answer the user's question. Summarize the content and ask if they have any additional questions about the topic.`,
        };
      })
        .ifFail((e) => {
          return {
            isError: true,
            error: e.message,
            solution:
              "A web search error occurred. First, explain to the user what caused this specific error and how they can resolve it. Then provide helpful information based on your existing knowledge to answer their question.",
          };
        })
        .unwrap();
    },
  });

// Default export for backward compatibility (without userId - will throw error if user tries to use without credits)
export const exaSearchTool = createExaSearchTool();

// Factory function to create Exa contents tool with userId bound
export const createExaContentsTool = (customerId?: string, entityId?: string) =>
  createTool({
    description:
      "Extract detailed content from specific URLs using Exa AI - retrieves full text content, metadata, and structured information from web pages with live crawling capabilities.",
    inputSchema: jsonSchemaToZod(exaContentsSchema),
    execute: async (params, { toolCallId }) => {
      return safe(async () => {
        const contentsRequest: ExaContentsRequest = {
          ids: params.urls,
          contents: {
            text: {
              maxCharacters: params.maxCharacters || 3000,
            },
            livecrawl: params.livecrawl || "preferred",
          },
        };

        return await fetchExa(
          "/contents",
          contentsRequest,
          customerId,
          toolCallId,
          entityId,
        );
      })
        .ifFail((e) => {
          return {
            isError: true,
            error: e.message,
            solution:
              "A web content extraction error occurred. First, explain to the user what caused this specific error and how they can resolve it. Then provide helpful information based on your existing knowledge to answer their question.",
          };
        })
        .unwrap();
    },
  });

// Default export for backward compatibility
export const exaContentsTool = createExaContentsTool();
