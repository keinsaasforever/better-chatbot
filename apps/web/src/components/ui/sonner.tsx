"use client";

import { useTheme } from "next-themes";
import { useMemo } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme();
  const themeBase = useMemo(() => {
    return theme == "dark" ? "dark" : "default";
  }, [theme]);
  return (
    // Top-centre, not sonner's bottom-right default: on a phone sonner renders
    // full-width at the bottom, landing directly on top of the composer's send
    // button. Only errors are raised as toasts now, so nothing here is routine
    // enough to be worth covering the primary action.
    <Sonner
      theme={themeBase as ToasterProps["theme"]}
      position="top-center"
      className="toaster group "
      {...props}
    />
  );
};

export { Toaster };
