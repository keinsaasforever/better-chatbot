export const sanitizeCssVariableName = (label: string) => {
  return label
    .replaceAll(" ", "")
    .toLowerCase()
    .replace(/[^a-z0-9\-_]/g, "_");
};

/** Themed default palette (adapts to light/dark via CSS variables). */
const DEFAULT_CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

/** White→blue monochrome ramp for the "blue" palette (dark to light). */
const BLUE_CHART_COLORS = [
  "#1e3a8a",
  "#2563eb",
  "#3b82f6",
  "#60a5fa",
  "#93c5fd",
];

/** Series colors for the requested palette. */
export const chartColorsForPalette = (
  palette: "default" | "blue" | null | undefined,
): string[] => (palette === "blue" ? BLUE_CHART_COLORS : DEFAULT_CHART_COLORS);

/**
 * Card class + style for the requested background. `"white"` forces a white
 * card with dark text regardless of theme (for a "white and blue" look);
 * otherwise the card follows the app theme.
 */
export const chartCardBackground = (
  background: "theme" | "white" | null | undefined,
): { className: string; style?: Record<string, string> } =>
  background === "white"
    ? {
        className: "bg-white text-neutral-900",
        style: { background: "#ffffff" },
      }
    : { className: "bg-card" };
