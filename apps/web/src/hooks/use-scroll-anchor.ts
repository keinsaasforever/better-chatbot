import { useCallback, useRef, useState } from "react";

/** Is the viewport within `threshold`px of the bottom of the container? */
export function isScrolledToBottom(
  el: { scrollHeight: number; scrollTop: number; clientHeight: number },
  threshold: number,
) {
  return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
}

/** Shared scroll-position tracking for the chat variants: owns the scroll
 * container ref, tracks whether the user is pinned to the bottom, and exposes
 * a scroll-to-bottom helper. */
export function useScrollAnchor({
  threshold = 50,
}: { threshold?: number } = {}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (el) setIsAtBottom(isScrolledToBottom(el, threshold));
  }, [threshold]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = containerRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  return { containerRef, isAtBottom, handleScroll, scrollToBottom };
}
