/**
 * The `data-theme` attribute that selects a theme palette lives on `<body>`,
 * because globals.css nests the palettes as `.light { [data-theme="…"] { … } }`
 * — a descendant selector, and next-themes puts `.light`/`.dark` on `<html>`.
 *
 * Its value is only known from localStorage, so it cannot be server-rendered.
 * ThemeStyleProvider used to solve that by rendering `null` until a layout
 * effect ran, which excluded the whole app from the server HTML and made every
 * page load appear to boot twice. Instead, a tiny blocking script sets the
 * attribute before first paint and the provider renders its children on the
 * server like any other provider.
 */

export const THEME_STYLE_STORAGE_KEY = "theme-style";
export const DEFAULT_THEME_STYLE = "default";

/** Mirrors the prefixes in `lib/browser-storage.ts`. */
const STORAGE_PREFIX = "CHATBOT-STORAGE";
const LEGACY_STORAGE_PREFIX = "ChATBOT-STOREAGE";

/**
 * Runs as the first child of `<body>`, before the rest of the document is
 * painted. Reads the same `{"value":…}` envelope `browser-storage.ts` writes,
 * falling back to the legacy misspelled prefix, and never throws — a blocked
 * localStorage (Safari private mode, cookie-blocking extensions) must degrade
 * to the default palette rather than break the page.
 */
export const THEME_STYLE_BOOTSTRAP_SCRIPT = `(function(){try{var k="${STORAGE_PREFIX}-${THEME_STYLE_STORAGE_KEY}",l="${LEGACY_STORAGE_PREFIX}-${THEME_STYLE_STORAGE_KEY}",r=localStorage.getItem(k)||localStorage.getItem(l),v=r?JSON.parse(r).value:null;document.body.setAttribute("data-theme",v||"${DEFAULT_THEME_STYLE}")}catch(e){document.body.setAttribute("data-theme","${DEFAULT_THEME_STYLE}")}})()`;
