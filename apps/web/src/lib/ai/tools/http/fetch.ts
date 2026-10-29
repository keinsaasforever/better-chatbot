import { JSONSchema7 } from "json-schema";
import { tool as createTool } from "ai";
import { jsonSchemaToZod } from "lib/json-schema-to-zod";
import { safe } from "ts-safe";

export const httpFetchSchema: JSONSchema7 = {
  type: "object",
  properties: {
    url: {
      type: "string",
      description: "The URL to make the HTTP request to",
    },
    method: {
      type: "string",
      enum: ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"],
      description: "The HTTP method to use",
      default: "GET",
    },
    headers: {
      type: "object",
      description: "Headers to include in the request",
      properties: {},
      additionalProperties: true,
    },
    body: {
      type: "string",
      description:
        "The request body (for POST, PUT, PATCH requests). Should be a JSON string if sending JSON data.",
    },
    timeout: {
      type: "number",
      description: "Request timeout in milliseconds",
      default: 10000,
    },
  },
  required: ["url"],
};

export const httpFetchTool = createTool({
  description:
    "Make HTTP requests to any URL. Can be used to fetch data from APIs, send data to servers, or interact with web services.",
  inputSchema: jsonSchemaToZod(httpFetchSchema),
  execute: async ({ url, method = "GET", headers, body, timeout = 10000 }) => {
    return safe(async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(url, {
          method,
          headers: headers ? { ...headers } : undefined,
          body:
            body && method !== "GET" && method !== "HEAD" ? body : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });

        let responseBody: any;
        const contentType = response.headers.get("content-type");

        if (contentType?.includes("application/json")) {
          responseBody = await response.json();
        } else if (contentType?.includes("text/")) {
          responseBody = await response.text();
        } else {
          responseBody = await response.text();
        }

        return {
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
          body: responseBody,
          ok: response.ok,
          url: response.url,
        };
      } catch (error) {
        clearTimeout(timeoutId);
        throw error;
      }
    })
      .ifFail((err) => {
        return {
          isError: true,
          error: err.message,
          solution:
            "An HTTP request error occurred. This could be due to network issues, invalid URL, timeout, or server errors. Check the URL and try again. For CORS issues, the server needs to allow your origin.",
        };
      })
      .unwrap();
  },
});
