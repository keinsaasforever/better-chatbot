// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useStableThreadId } from "./use-stable-thread-id";

describe("useStableThreadId", () => {
  it("keeps the generated id across re-renders when no id is supplied", () => {
    const { result, rerender } = renderHook(() => useStableThreadId());

    const first = result.current;
    expect(first).toBeTruthy();

    rerender();
    rerender();

    // The `/` page re-renders on every Server Action; the id must not move.
    expect(result.current).toBe(first);
  });

  it("uses the supplied id and follows it when the route changes threads", () => {
    const { result, rerender } = renderHook(
      ({ threadId }: { threadId?: string }) => useStableThreadId(threadId),
      { initialProps: { threadId: "thread-a" } },
    );

    expect(result.current).toBe("thread-a");

    rerender({ threadId: "thread-b" });
    expect(result.current).toBe("thread-b");
  });

  it("falls back to the stable id when the supplied id goes away", () => {
    const { result, rerender } = renderHook(
      ({ threadId }: { threadId?: string }) => useStableThreadId(threadId),
      { initialProps: { threadId: "thread-a" as string | undefined } },
    );

    rerender({ threadId: undefined });
    const fallback = result.current;
    expect(fallback).not.toBe("thread-a");

    rerender({ threadId: undefined });
    expect(result.current).toBe(fallback);
  });

  it("gives separate mounts separate ids", () => {
    const a = renderHook(() => useStableThreadId());
    const b = renderHook(() => useStableThreadId());

    expect(a.result.current).not.toBe(b.result.current);
  });
});
