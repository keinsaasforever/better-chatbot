import { type ClassValue, clsx } from "clsx";
import { JSONSchema7 } from "json-schema";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Pulls a human-readable message out of an error body.
 *
 * Routes in this app answer with two shapes: a flat `{ error: "..." }` and,
 * for everything behind `toProjectErrorResponse`, a nested
 * `{ error: { code, message } }`. Passing the nested object straight to
 * `new Error()` stringifies it, so every failing project route surfaced as the
 * literal text "[object Object]" — the knowledge graph rendering that instead
 * of its real error is what made this visible.
 */
export function errorMessageFromPayload(payload: unknown): string | undefined {
  if (typeof payload === "string") return payload || undefined;
  if (!payload || typeof payload !== "object") return undefined;

  const { message, error, detail } = payload as {
    message?: unknown;
    error?: unknown;
    detail?: unknown;
  };

  if (typeof message === "string" && message) return message;
  if (typeof error === "string" && error) return error;
  if (error && typeof error === "object") {
    const nested = (error as { message?: unknown }).message;
    if (typeof nested === "string" && nested) return nested;
  }
  // Some upstreams (AssemblyAI, Composio) use `detail` instead.
  if (typeof detail === "string" && detail) return detail;
  return undefined;
}

export const fetcher = async (url: string, options?: RequestInit) => {
  const res = await fetch(url, {
    redirect: "follow",
    cache: "no-store",
    ...options,
  });

  if (!res.ok) {
    let errorPayload;
    try {
      errorPayload = await res.json();
    } catch {
      errorPayload = { message: `Request failed with status ${res.status}` };
    }
    const error = new Error(
      errorMessageFromPayload(errorPayload) ||
        "An error occurred while fetching the data.",
    );
    Object.assign(error, { info: errorPayload, status: res.status });
    throw error;
  }

  return res.json();
};

export const noop = () => {};

export const wait = (delay = 0) =>
  new Promise<void>((resolve) => setTimeout(resolve, delay));

export const isString = (value: any): value is string =>
  typeof value === "string";

export const isFunction = <
  T extends (...args: any[]) => any = (...args: any[]) => any,
>(
  v: unknown,
): v is T => typeof v === "function";

export const isObject = (value: any): value is Record<string, any> =>
  Object(value) === value;

export const isNull = (value: any): value is null | undefined => value == null;

export const isJson = (value: any): value is Record<string, any> => {
  try {
    if (typeof value === "string") {
      const str = value.trim();
      JSON.parse(str);
      return true;
    } else if (isObject(value)) {
      return true;
    }
    return false;
  } catch (_e) {
    return false;
  }
};

export const createDebounce = () => {
  let timeout: ReturnType<typeof setTimeout>;

  const debounce = (func: (...args: any[]) => any, waitFor = 200) => {
    clearTimeout(timeout!);
    timeout = setTimeout(() => func(), waitFor);
    return timeout;
  };

  debounce.clear = () => {
    clearTimeout(timeout!);
  };
  return debounce;
};

export const groupBy = <T>(arr: T[], getter: keyof T | ((item: T) => string)) =>
  arr.reduce(
    (prev, item) => {
      const key: string =
        getter instanceof Function ? getter(item) : (item[getter] as string);

      if (!prev[key]) prev[key] = [];
      prev[key].push(item);
      return prev;
    },
    {} as Record<string, T[]>,
  );

export class Locker {
  private promise = Promise.resolve();
  private resolve?: () => void;

  get isLocked() {
    return !!this.resolve;
  }

  lock() {
    this.promise = new Promise((resolve) => {
      this.resolve = resolve;
    });
  }
  unlock() {
    if (!this.isLocked) return;
    this.resolve?.();
    this.resolve = undefined;
  }
  async wait() {
    await this.promise;
  }
}

export function safeJSONParse<T = unknown>(
  json: string,
):
  | {
      success: true;
      value: T;
      error?: unknown;
    }
  | {
      success: false;
      error: unknown;
      value?: T;
    } {
  try {
    const parsed = JSON.parse(json);
    return {
      success: true,
      value: parsed,
    };
  } catch (e) {
    return {
      success: false,
      error: e,
    };
  }
}

export function generateUUID(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  // Fallback for insecure contexts (e.g. http on a LAN IP, not localhost) where
  // crypto.randomUUID is unavailable. Not cryptographically strong.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function toAny<T>(value: T): any {
  return value;
}

export function errorToString(error: unknown) {
  if (error == null) {
    return "unknown error";
  }

  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return JSON.stringify(error);
}

export function objectFlow<T extends Record<string, any>>(obj: T) {
  return {
    map: <R>(
      fn: (value: T[keyof T], key: keyof T) => R,
    ): Record<keyof T, R> => {
      return Object.fromEntries(
        Object.entries(obj).map(([key, value]) => [key, fn(value, key)]),
      ) as Record<keyof T, R>;
    },
    filter: (
      fn: (value: T[keyof T], key: keyof T) => boolean,
    ): Record<keyof T, T[keyof T]> => {
      return Object.fromEntries(
        Object.entries(obj).filter(([key, value]) => fn(value, key)),
      ) as Record<keyof T, T[keyof T]>;
    },

    forEach: (fn: (value: T[keyof T], key: keyof T) => void): void => {
      Object.entries(obj).forEach(([key, value]) => fn(value, key));
    },
    some: (fn: (value: T[keyof T], key: keyof T) => any): boolean => {
      return Object.entries(obj).some(([key, value]) => fn(value, key));
    },
    every: (fn: (value: T[keyof T], key: keyof T) => any): boolean => {
      return Object.entries(obj).every(([key, value]) => fn(value, key));
    },
    find(fn: (value: T[keyof T], key: keyof T) => any): T | undefined {
      return Object.entries(obj).find(([key, value]) => fn(value, key))?.[1];
    },
    getByPath<U>(path: string[]): U | undefined {
      let result: any = obj;
      path.find((p) => {
        result = result?.[p];
        return !result;
      });
      return result;
    },
    setByPath(path: string[], value: any) {
      path.reduce((acc, cur, i) => {
        const isLast = i == path.length - 1;
        if (isLast) {
          acc[cur] = value;
          return acc;
        }
        acc[cur] ??= {};
        return acc[cur];
      }, obj as object);
      return obj;
    },
  };
}

export function capitalizeFirstLetter(str: string): string {
  if (!str || str.length === 0) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + "...";
}

export async function nextTick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function cleanVariableName(input: string = ""): string {
  if (!input || typeof input !== "string") {
    return "";
  }

  return input.replace(/[^\w\u0080-\uFFFF-]/g, "").replace(/^[0-9]+/, "");
}

export function generateUniqueKey(key: string, existingKeys: string[]) {
  let newKey = key;
  let counter = 1;

  while (existingKeys.includes(newKey)) {
    const baseKey = key.replace(/\d+$/, "");
    const hasOriginalNumber = key !== baseKey;
    if (hasOriginalNumber) {
      const originalNumber = parseInt(key.match(/\d+$/)?.[0] || "0");
      newKey = baseKey + (originalNumber + counter);
    } else {
      newKey = baseKey + counter;
    }
    counter++;
  }
  return newKey;
}

export function exclude<T extends object, K extends keyof T>(
  obj: T,
  keys: K[],
): Omit<T, K> {
  return Object.fromEntries(
    Object.entries(obj).filter(([key]) => !keys.includes(key as K)),
  ) as Omit<T, K>;
}

export function validateSchema(key: string, schema: JSONSchema7) {
  const variableName = cleanVariableName(key);
  if (variableName.length === 0) {
    throw new Error("Invalid Variable Name");
  }
  if (variableName.length > 255) {
    throw new Error("Variable Name is too long");
  }
  if (!schema.type) {
    throw new Error("Invalid Schema");
  }
  if (schema.type == "array" || schema.type == "object") {
    const keys = Array.from(Object.keys(schema.properties ?? {}));
    if (keys.length != new Set(keys).size) {
      throw new Error("Output data must have unique keys");
    }
    return keys.every((key) => {
      return validateSchema(key, schema.properties![key] as JSONSchema7);
    });
  }
  return true;
}

export const createEmitter = () => {
  const listeners = new Set<(value: string) => void>();
  return {
    on: (listener: (value: string) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    off: (listener: (value: string) => void) => {
      listeners.delete(listener);
    },
    emit: (value: string) => {
      listeners.forEach((listener) => listener(value));
    },
  };
};

export function deduplicateByKey<T>(arr: T[], key: keyof T): T[] {
  const seen = new Set<T[keyof T]>();
  return arr.filter((item) => {
    const keyValue = item[key];
    if (seen.has(keyValue)) {
      return false;
    } else {
      seen.add(keyValue);
      return true;
    }
  });
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Timeout"));
    }, ms);
    promise
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export function parseEnvBoolean(value: string | boolean | undefined): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lowerVal = value.toLowerCase();
    return lowerVal === "true" || lowerVal === "1" || lowerVal === "y";
  }
  return false;
}

export function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return "0 Bytes";

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = [
    "Bytes",
    "KiB",
    "MiB",
    "GiB",
    "TiB",
    "PiB",
    "EiB",
    "ZiB",
    "YiB",
  ];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}
