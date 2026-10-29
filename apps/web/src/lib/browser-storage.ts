"use client";

import { IS_BROWSER } from "./const";

const PRE_FIX = "CHATBOT-STORAGE";
// The prefix used to be misspelled "ChATBOT-STOREAGE". Fall back to it on read
// and migrate to the corrected prefix so existing user prefs survive the fix.
const LEGACY_PRE_FIX = "ChATBOT-STOREAGE";

const get = <T>(
  storage: Storage,
  key: string,
  defaultValue?: T,
): T | undefined => {
  let value = storage.getItem(`${PRE_FIX}-${key}`);
  if (value == null) {
    const legacy = storage.getItem(`${LEGACY_PRE_FIX}-${key}`);
    if (legacy != null) {
      storage.setItem(`${PRE_FIX}-${key}`, legacy);
      storage.removeItem(`${LEGACY_PRE_FIX}-${key}`);
      value = legacy;
    }
  }
  if (value) return JSON.parse(value).value;
  return defaultValue;
};

const set = (storage: Storage, key: string, value: any) => {
  storage.setItem(`${PRE_FIX}-${key}`, JSON.stringify({ value }));
};

const remove = (storage: Storage, key: string) => {
  storage.removeItem(`${PRE_FIX}-${key}`);
  storage.removeItem(`${LEGACY_PRE_FIX}-${key}`);
};

export interface StorageManager<T = any> {
  get(): T | undefined;
  get(defaultValue: T): T;
  set(value: T | ((prev?: T) => T)): void;
  remove(): void;
  isEmpty?: boolean;
}
export const getStorageManager = <T>(
  key: string,
  storageType: "local" | "session" = "local",
): StorageManager<T> => {
  if (!IS_BROWSER)
    return {
      get: () => undefined,
      set: () => {},
      remove: () => {},
      isEmpty: true,
    } as unknown as StorageManager<T>;
  const storage = storageType === "local" ? localStorage : sessionStorage;
  if (!(storage instanceof Storage))
    throw Error(
      `${storageType} is not StorageType required 'local'|'session' `,
    );
  const context = {
    get: ((defaultValue?: T): T | undefined =>
      get(storage, key, defaultValue)) as StorageManager<T>["get"],
    set: (value: T | ((prev?: T) => T)) => {
      const prev = get(storage, key);
      set(
        storage,
        key,
        typeof value === "function" ? (value as any)(prev) : value,
      );
    },
    remove: () => remove(storage, key),
    size: () => (storage.getItem(`${PRE_FIX}-${key}`) || "").length,
  };
  Object.defineProperty(context, "isEmpty", {
    get() {
      return this.get() == null;
    },
  });

  return context;
};
