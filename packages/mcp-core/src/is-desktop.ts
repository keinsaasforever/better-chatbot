/** Feature-detect the Electron desktop shell exposed via preload. */
export const isDesktop = typeof window !== "undefined" && "desktop" in window;
