import { describe, it, expect } from "vitest";

import { JSONSchema7 } from "json-schema";
import { jsonSchemaToZod, jsonSchemaStringToZod } from "./json-schema-to-zod";

// Import the tavilySearchSchema for testing
const tavilySearchSchema: JSONSchema7 = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "Search query",
    },
    search_depth: {
      type: "string",
      enum: ["basic", "advanced"],
      description: "The depth of the search. It can be 'basic' or 'advanced'",
      default: "basic",
    },
    topic: {
      type: "string",
      enum: ["general", "news"],
      description:
        "The category of the search. This will determine which of our agents will be used for the search",
      default: "general",
    },
    days: {
      type: "number",
      description:
        "The number of days back from the current date to include in the search results. This specifies the time frame of data to be retrieved. Please note that this feature is only available when using the 'news' search topic",
      default: 3,
    },
    time_range: {
      type: "string",
      description:
        "The time range back from the current date to include in the search results. This feature is available for both 'general' and 'news' search topics",
      enum: ["day", "week", "month", "year", "d", "w", "m", "y"],
    },
    max_results: {
      type: "number",
      description: "The maximum number of search results to return",
      default: 10,
      minimum: 5,
      maximum: 20,
    },
    include_images: {
      type: "boolean",
      description: "Include a list of query-related images in the response",
      default: false,
    },
    include_domains: {
      type: "array",
      items: { type: "string" },
      description:
        "A list of domains to specifically include in the search results, if the user asks to search on specific sites set this to the domain of the site",
      default: [],
    },
    country: {
      type: "string",
      enum: [
        "afghanistan",
        "albania",
        "algeria",
        "australia",
        "austria",
        "canada",
        "china",
        "france",
        "germany",
        "japan",
        "south korea",
        "united kingdom",
        "united states",
      ],
      description:
        "Boost search results from a specific country. This will prioritize content from the selected country in the search results. Available only if topic is general.",
      default: "",
    },
  },
  required: ["query"],
};

describe("jsonSchemaToZod (simplified)", () => {
  it("should convert string type", () => {
    const jsonSchema: JSONSchema7 = { type: "string" };
    const zodSchema = jsonSchemaToZod(jsonSchema);

    expect(zodSchema.parse("hello")).toBe("hello");
    expect(() => zodSchema.parse(123)).toThrow();
  });

  it("should convert number type", () => {
    const jsonSchema: JSONSchema7 = { type: "number" };
    const zodSchema = jsonSchemaToZod(jsonSchema);

    expect(zodSchema.parse(123)).toBe(123);
    expect(zodSchema.parse(123.45)).toBe(123.45);
    expect(() => zodSchema.parse("123")).toThrow();
  });

  it("should convert integer type", () => {
    const jsonSchema: JSONSchema7 = { type: "integer" };
    const zodSchema = jsonSchemaToZod(jsonSchema);

    expect(zodSchema.parse(123)).toBe(123);
    expect(() => zodSchema.parse(123.45)).toThrow();
  });

  it("should convert boolean type", () => {
    const jsonSchema: JSONSchema7 = { type: "boolean" };
    const zodSchema = jsonSchemaToZod(jsonSchema);

    expect(zodSchema.parse(true)).toBe(true);
    expect(zodSchema.parse(false)).toBe(false);
    expect(() => zodSchema.parse("true")).toThrow();
  });

  it("should convert array type", () => {
    const jsonSchema: JSONSchema7 = {
      type: "array",
      items: { type: "string" },
    };
    const zodSchema = jsonSchemaToZod(jsonSchema);

    expect(zodSchema.parse(["a", "b", "c"])).toEqual(["a", "b", "c"]);
    expect(() => zodSchema.parse([1, 2, 3])).toThrow();
  });

  it("should convert object type", () => {
    const jsonSchema: JSONSchema7 = {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "integer" },
      },
      required: ["name"],
    };
    const zodSchema = jsonSchemaToZod(jsonSchema);

    const validData = {
      name: "John",
      age: 30,
    };

    expect(zodSchema.parse(validData)).toEqual(validData);

    // Missing required field
    expect(() => zodSchema.parse({ age: 30 })).toThrow();

    // Optional field can be omitted
    expect(zodSchema.parse({ name: "John" })).toEqual({
      name: "John",
    });
  });

  it("should handle enum", () => {
    const jsonSchema: JSONSchema7 = {
      enum: ["red", "green", "blue"],
    };
    const zodSchema = jsonSchemaToZod(jsonSchema);

    expect(zodSchema.parse("red")).toBe("red");
    expect(() => zodSchema.parse("yellow")).toThrow();
  });

  it("should handle single enum value as literal", () => {
    const jsonSchema: JSONSchema7 = {
      enum: ["red"],
    };
    const zodSchema = jsonSchemaToZod(jsonSchema);

    expect(zodSchema.parse("red")).toBe("red");
    expect(() => zodSchema.parse("blue")).toThrow();
  });

  it("should handle null type", () => {
    const jsonSchema: JSONSchema7 = { type: "null" };
    const zodSchema = jsonSchemaToZod(jsonSchema);

    expect(zodSchema.parse(null)).toBe(null);
    expect(() => zodSchema.parse("null")).toThrow();
  });

  it("should handle unknown type", () => {
    const jsonSchema: JSONSchema7 = {};
    const zodSchema = jsonSchemaToZod(jsonSchema);

    expect(zodSchema.parse("anything")).toBe("anything");
    expect(zodSchema.parse(123)).toBe(123);
    expect(zodSchema.parse(true)).toBe(true);
  });

  describe("Enhanced features", () => {
    it("should handle default values for primitives", () => {
      const stringWithDefault: JSONSchema7 = {
        type: "string",
        default: "hello",
      };
      const zodSchema = jsonSchemaToZod(stringWithDefault);

      expect(zodSchema.parse(undefined)).toBe("hello");
      expect(zodSchema.parse("world")).toBe("world");
    });

    it("should handle number constraints", () => {
      const numberWithConstraints: JSONSchema7 = {
        type: "number",
        minimum: 5,
        maximum: 20,
        default: 10,
      };
      const zodSchema = jsonSchemaToZod(numberWithConstraints);

      expect(zodSchema.parse(undefined)).toBe(10);
      expect(zodSchema.parse(10)).toBe(10);
      expect(zodSchema.parse(5)).toBe(5);
      expect(zodSchema.parse(20)).toBe(20);
      expect(() => zodSchema.parse(4)).toThrow();
      expect(() => zodSchema.parse(21)).toThrow();
    });

    it("should handle enum with default", () => {
      const enumWithDefault: JSONSchema7 = {
        enum: ["basic", "advanced"],
        default: "basic",
      };
      const zodSchema = jsonSchemaToZod(enumWithDefault);

      expect(zodSchema.parse(undefined)).toBe("basic");
      expect(zodSchema.parse("advanced")).toBe("advanced");
      expect(() => zodSchema.parse("invalid")).toThrow();
    });

    it("should handle array with default", () => {
      const arrayWithDefault: JSONSchema7 = {
        type: "array",
        items: { type: "string" },
        default: [],
      };
      const zodSchema = jsonSchemaToZod(arrayWithDefault);

      expect(zodSchema.parse(undefined)).toEqual([]);
      expect(zodSchema.parse(["a", "b"])).toEqual(["a", "b"]);
    });
  });

  describe("TavilySearchSchema Integration", () => {
    it("should handle the complete tavilySearchSchema", () => {
      const zodSchema = jsonSchemaToZod(tavilySearchSchema);

      // Test with only required field
      const minimalInput = { query: "test search" };
      const result = zodSchema.parse(minimalInput);

      expect(result.query).toBe("test search");
      expect(result.search_depth).toBe("basic"); // default
      expect(result.topic).toBe("general"); // default
      expect(result.days).toBe(3); // default
      expect(result.max_results).toBe(10); // default
      expect(result.include_images).toBe(false); // default
      expect(result.include_domains).toEqual([]); // default
      expect(result.country).toBe(undefined); // default invalid enum value becomes optional
    });

    it("should validate enum values in tavilySearchSchema", () => {
      const zodSchema = jsonSchemaToZod(tavilySearchSchema);

      // Valid enum values
      expect(() =>
        zodSchema.parse({
          query: "test",
          search_depth: "advanced",
          topic: "news",
          time_range: "week",
          country: "united states",
        }),
      ).not.toThrow();

      // Invalid enum values
      expect(() =>
        zodSchema.parse({
          query: "test",
          search_depth: "invalid",
        }),
      ).toThrow();

      expect(() =>
        zodSchema.parse({
          query: "test",
          topic: "invalid",
        }),
      ).toThrow();
    });

    it("should validate number constraints in tavilySearchSchema", () => {
      const zodSchema = jsonSchemaToZod(tavilySearchSchema);

      // Valid max_results
      expect(() =>
        zodSchema.parse({
          query: "test",
          max_results: 5,
        }),
      ).not.toThrow();

      expect(() =>
        zodSchema.parse({
          query: "test",
          max_results: 20,
        }),
      ).not.toThrow();

      // Invalid max_results
      expect(() =>
        zodSchema.parse({
          query: "test",
          max_results: 4,
        }),
      ).toThrow();

      expect(() =>
        zodSchema.parse({
          query: "test",
          max_results: 21,
        }),
      ).toThrow();
    });

    it("should require the query field", () => {
      const zodSchema = jsonSchemaToZod(tavilySearchSchema);

      // Missing required field
      expect(() => zodSchema.parse({})).toThrow();
      expect(() => zodSchema.parse({ search_depth: "basic" })).toThrow();

      // With required field
      expect(() => zodSchema.parse({ query: "test" })).not.toThrow();
    });

    it("should handle optional fields correctly", () => {
      const zodSchema = jsonSchemaToZod(tavilySearchSchema);

      const result = zodSchema.parse({
        query: "test",
        search_depth: "advanced",
        max_results: 15,
        include_images: true,
        include_domains: ["example.com", "test.com"],
      });

      expect(result.query).toBe("test");
      expect(result.search_depth).toBe("advanced");
      expect(result.max_results).toBe(15);
      expect(result.include_images).toBe(true);
      expect(result.include_domains).toEqual(["example.com", "test.com"]);
      // Optional field not provided should get default
      expect(result.topic).toBe("general");
    });
  });
});

describe("jsonSchemaStringToZod", () => {
  it("should parse JSON string and convert to Zod", () => {
    const jsonSchemaString = JSON.stringify({
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
      },
      required: ["name"],
    });

    const zodSchema = jsonSchemaStringToZod(jsonSchemaString);

    expect(zodSchema.parse({ name: "John", age: 30 })).toEqual({
      name: "John",
      age: 30,
    });
  });

  it("should throw error for invalid JSON", () => {
    expect(() => jsonSchemaStringToZod("invalid json")).toThrow();
  });
});
