/**
 * @module tagged-types
 * Minimal runtime type checking with discriminated unions
 */

const DEFAULT_KEY = "__$ref__" as const;

export type Tagged<TTag extends string, TData> = TData & {
  [DEFAULT_KEY]: TTag;
};

class TagBuilder<TData, TTag extends string> {
  constructor(private tagValue: TTag) {}

  isMaybe = (value: unknown): value is Tagged<TTag, TData> => {
    return (
      value !== null &&
      value !== undefined &&
      typeof value === "object" &&
      DEFAULT_KEY in value &&
      (value as any)[DEFAULT_KEY] === this.tagValue
    );
  };

  create = (data: TData): Tagged<TTag, TData> => {
    return {
      ...data,
      [DEFAULT_KEY]: this.tagValue,
    } as Tagged<TTag, TData>;
  };
  unwrap = (value: Tagged<TTag, TData>): TData => {
    const { [DEFAULT_KEY]: _, ...data } = value;
    return data as TData;
  };
}

export function tag<TData>(tagName: string) {
  return Object.freeze(new TagBuilder<TData, typeof tagName>(tagName));
}
