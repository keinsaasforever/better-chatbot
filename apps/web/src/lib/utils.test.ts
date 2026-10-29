import { describe, expect, test, vi } from "vitest";
import {
  groupBy,
  errorToString,
  errorMessageFromPayload,
  objectFlow,
  parseEnvBoolean,
} from "./utils";

describe("groupBy", () => {
  test("group by function key", () => {
    const items = [
      { id: 1, category: "A" },
      { id: 2, category: "B" },
      { id: 3, category: "A" },
      { id: 4, category: "C" },
    ];

    const result = groupBy(items, (item) => item.category);

    expect(result).toEqual({
      A: [
        { id: 1, category: "A" },
        { id: 3, category: "A" },
      ],
      B: [{ id: 2, category: "B" }],
      C: [{ id: 4, category: "C" }],
    });
  });

  test("group by string key", () => {
    const items = [
      { id: 1, category: "A" },
      { id: 2, category: "B" },
      { id: 3, category: "A" },
      { id: 4, category: "C" },
    ];

    const result = groupBy(items, "category");

    expect(result).toEqual({
      A: [
        { id: 1, category: "A" },
        { id: 3, category: "A" },
      ],
      B: [{ id: 2, category: "B" }],
      C: [{ id: 4, category: "C" }],
    });
  });

  test("group empty array", () => {
    const items: Array<{ id: number; category: string }> = [];

    const result = groupBy(items, "category");

    expect(result).toEqual({});
  });
});

describe("errorToString", () => {
  test("convert string error", () => {
    expect(errorToString("error message")).toBe("error message");
  });

  test("convert Error object", () => {
    const error = new Error("test error");
    expect(errorToString(error)).toBe("test error");
  });

  test("convert null error", () => {
    expect(errorToString(null)).toBe("unknown error");
  });

  test("convert undefined error", () => {
    expect(errorToString(undefined)).toBe("unknown error");
  });

  test("convert object error", () => {
    const obj = { message: "error object" };
    expect(errorToString(obj)).toBe('{"message":"error object"}');
  });
});

describe("objectFlow", () => {
  const testObj = {
    a: 1,
    b: 2,
    c: 3,
    d: 4,
  };

  test("map function", () => {
    const result = objectFlow(testObj).map((value) => value * 2);
    expect(result).toEqual({
      a: 2,
      b: 4,
      c: 6,
      d: 8,
    });
  });

  test("filter function", () => {
    const result = objectFlow(testObj).filter((value) => value % 2 === 0);
    expect(result).toEqual({
      b: 2,
      d: 4,
    });
  });

  test("forEach function", () => {
    const mockFn = vi.fn();
    objectFlow(testObj).forEach(mockFn);
    expect(mockFn).toHaveBeenCalledTimes(4);
  });

  test("some function: true case", () => {
    const result = objectFlow(testObj).some((value) => value > 3);
    expect(result).toBe(true);
  });

  test("some function: false case", () => {
    const result = objectFlow(testObj).some((value) => value > 10);
    expect(result).toBe(false);
  });

  test("every function: true case", () => {
    const result = objectFlow(testObj).every((value) => value > 0);
    expect(result).toBe(true);
  });

  test("every function: false case", () => {
    const result = objectFlow(testObj).every((value) => value > 2);
    expect(result).toBe(false);
  });

  test("find function", () => {
    const result = objectFlow(testObj).find((value) => value > 2);
    expect(result).toBe(3);
  });

  test("find function: no result", () => {
    const result = objectFlow(testObj).find((value) => value > 10);
    expect(result).toBeUndefined();
  });
});

describe("parseEnvBoolean", () => {
  test("should return true for boolean true", () => {
    expect(parseEnvBoolean(true)).toBe(true);
  });

  test("should return false for boolean false", () => {
    expect(parseEnvBoolean(false)).toBe(false);
  });

  test("should return true for string 'true'", () => {
    expect(parseEnvBoolean("true")).toBe(true);
  });

  test("should return true for string 'True' (case insensitive)", () => {
    expect(parseEnvBoolean("True")).toBe(true);
  });

  test("should return true for string 'TRUE' (case insensitive)", () => {
    expect(parseEnvBoolean("TRUE")).toBe(true);
  });

  test("should return true for string '1'", () => {
    expect(parseEnvBoolean("1")).toBe(true);
  });

  test("should return true for string 'y'", () => {
    expect(parseEnvBoolean("y")).toBe(true);
  });

  test("should return true for string 'Y' (case insensitive)", () => {
    expect(parseEnvBoolean("Y")).toBe(true);
  });

  test("should return false for string 'false'", () => {
    expect(parseEnvBoolean("false")).toBe(false);
  });

  test("should return false for string 'False' (case insensitive)", () => {
    expect(parseEnvBoolean("False")).toBe(false);
  });

  test("should return false for string '0'", () => {
    expect(parseEnvBoolean("0")).toBe(false);
  });

  test("should return false for string 'n'", () => {
    expect(parseEnvBoolean("n")).toBe(false);
  });

  test("should return false for string 'no'", () => {
    expect(parseEnvBoolean("no")).toBe(false);
  });

  test("should return false for empty string", () => {
    expect(parseEnvBoolean("")).toBe(false);
  });

  test("should return false for random string", () => {
    expect(parseEnvBoolean("random")).toBe(false);
  });

  test("should return false for undefined", () => {
    expect(parseEnvBoolean(undefined)).toBe(false);
  });

  test("should return false for whitespace only string", () => {
    expect(parseEnvBoolean("   ")).toBe(false);
  });

  test("should handle mixed case variations", () => {
    expect(parseEnvBoolean("tRuE")).toBe(true);
    expect(parseEnvBoolean("fAlSe")).toBe(false);
  });
});

describe("errorMessageFromPayload", () => {
  test("reads the nested shape every project route answers with", () => {
    // toProjectErrorResponse returns { error: { code, message } }. Passing that
    // object to new Error() stringified it, so failing project routes rendered
    // the literal text "[object Object]".
    expect(
      errorMessageFromPayload({
        error: { code: "connector_requires_auth", message: "Reconnect first." },
      }),
    ).toBe("Reconnect first.");
  });

  test("still reads the flat shapes", () => {
    expect(errorMessageFromPayload({ message: "Boom" })).toBe("Boom");
    expect(errorMessageFromPayload({ error: "Boom" })).toBe("Boom");
  });

  test("prefers message over error when both are present", () => {
    expect(errorMessageFromPayload({ message: "outer", error: "inner" })).toBe(
      "outer",
    );
  });

  test("falls back to detail, which upstream APIs use", () => {
    expect(errorMessageFromPayload({ detail: "Invalid API key" })).toBe(
      "Invalid API key",
    );
  });

  test("returns undefined when there is nothing readable", () => {
    expect(errorMessageFromPayload({})).toBeUndefined();
    expect(errorMessageFromPayload(null)).toBeUndefined();
    expect(errorMessageFromPayload({ error: {} })).toBeUndefined();
    expect(errorMessageFromPayload({ error: { code: "x" } })).toBeUndefined();
    // Never yields the string that made this bug invisible.
    expect(errorMessageFromPayload({ error: { a: 1 } })).not.toBe(
      "[object Object]",
    );
  });
});
