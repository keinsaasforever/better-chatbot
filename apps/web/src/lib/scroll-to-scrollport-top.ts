/**
 * Scroll helpers for pinning a message to the top of the chat viewport.
 *
 * `Element.scrollIntoView()` is deliberately avoided here: it scrolls *every*
 * ancestor scrollport (including the document), so on mobile — where the chat
 * scroller sits inside a `h-dvh` shell and the trailing spacers are sized in
 * `dvh` — it overshoots and parks the freshly-sent prompt above the viewport,
 * hidden behind the app header. Scrolling one resolved scrollport to a clamped
 * offset keeps the message top just below the header on every viewport.
 */

/** Nearest ancestor that actually scrolls vertically, or null if none does. */
export function findScrollport(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      node.scrollHeight > node.clientHeight
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/** Clamped target `scrollTop` that puts `elementTop` at the scrollport top. */
export function scrollTopForTopAlignment(
  metrics: {
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
    scrollportTop: number;
    elementTop: number;
  },
  offset: number,
): number {
  const delta = metrics.elementTop - metrics.scrollportTop - offset;
  const max = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
  return Math.min(Math.max(0, metrics.scrollTop + delta), max);
}

/**
 * Align `el`'s top with the top of its scrollport, leaving `offset` px of
 * breathing room. No-op when nothing around `el` scrolls.
 */
export function scrollToScrollportTop(
  el: HTMLElement | null,
  {
    offset = 8,
    behavior = "smooth",
  }: ScrollToOptions & { offset?: number } = {},
) {
  if (!el) return;
  const scrollport = findScrollport(el);
  if (!scrollport) return;
  const top = scrollTopForTopAlignment(
    {
      scrollTop: scrollport.scrollTop,
      scrollHeight: scrollport.scrollHeight,
      clientHeight: scrollport.clientHeight,
      scrollportTop: scrollport.getBoundingClientRect().top,
      elementTop: el.getBoundingClientRect().top,
    },
    offset,
  );
  scrollport.scrollTo({ top, behavior });
}
