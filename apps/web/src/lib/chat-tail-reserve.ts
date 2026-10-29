/**
 * How much empty space to reserve below a freshly-sent prompt.
 *
 * After you send, the newest user message should sit at the top of the chat
 * viewport with the answer streaming in underneath. That needs filler below it,
 * because the composer floats over the bottom of the scroll region.
 *
 * The filler used to be a fixed `calc(55dvh - 56px)` plus a `13rem` tail. On a
 * phone that is *more* than the room below the message, so "scrolled to the
 * bottom" became a position where the message top sat above the scrollport —
 * i.e. hidden behind the header, with only the bubble's bottom edge showing.
 * Measured at 390px wide: 27px hidden at a 700px viewport, 90px at 560px.
 *
 * Reserving exactly the remaining room instead makes max-scroll *equal to*
 * "message pinned at the top", so no scroll position can hide it.
 *
 * The reserve is floored at the composer's own height: the composer floats over
 * the bottom of the scroll region, so the tail must always be able to scroll
 * clear of it. Without that floor a long answer — where there is no room left
 * to pin anything — ends up with its last lines behind the input.
 */
export function tailReservePx(metrics: {
  /** Visible height of the scroll region. */
  clientHeight: number;
  /** Height of everything from the newest user message down, filler excluded. */
  contentBelowMessageTop: number;
  /** Height of the composer plus the gap it floats above. */
  composerOverlay: number;
  /** The scroll region's own top padding. */
  scrollPaddingTop: number;
}): number {
  const floor = Number.isFinite(metrics.composerOverlay)
    ? Math.max(0, Math.round(metrics.composerOverlay))
    : 0;
  const room =
    metrics.clientHeight -
    metrics.contentBelowMessageTop -
    metrics.composerOverlay -
    metrics.scrollPaddingTop;
  if (!Number.isFinite(room)) return floor;
  return Math.max(floor, Math.round(room));
}
