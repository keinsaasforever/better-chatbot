"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import { useThemeStyle } from "@/hooks/use-theme-style";

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
/**
 * Keeps `<body data-theme>` in sync when the user switches palette at runtime.
 *
 * The *initial* value is set before first paint by
 * THEME_STYLE_BOOTSTRAP_SCRIPT in the root layout, so this provider must render
 * its children unconditionally. It previously returned `null` until a
 * `useLayoutEffect` flipped a `mounted` flag — because layout effects never run
 * on the server that excluded the entire app from the server HTML, and every
 * page load painted an empty document before booting the whole tree on the
 * client. That is the "double load".
 */
export const ThemeStyleProvider = React.memo(function ({
  children,
}: {
  children: React.ReactNode;
}) {
  const { themeStyle } = useThemeStyle();

  React.useEffect(() => {
    if (document.body.getAttribute("data-theme") !== themeStyle) {
      document.body.setAttribute("data-theme", themeStyle);
    }
  }, [themeStyle]);

  return children;
});

ThemeStyleProvider.displayName = "ThemeStyleProvider";
