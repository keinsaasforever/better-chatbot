"use client";
import {
  DEFAULT_THEME_STYLE,
  THEME_STYLE_STORAGE_KEY,
} from "@/lib/theme/theme-style-bootstrap";
import { getStorageManager } from "lib/browser-storage";
import { createEmitter } from "lib/utils";
import { useCallback, useEffect, useState } from "react";

const storage = getStorageManager<string>(THEME_STYLE_STORAGE_KEY);

const emitter = createEmitter();

export function useThemeStyle() {
  const [themeStyle, _setThemeStyle] = useState(
    storage.get(DEFAULT_THEME_STYLE),
  );

  const setThemeStyle = useCallback((value: string) => {
    storage.set(value);
    _setThemeStyle(value);
    emitter.emit(value);
  }, []);

  useEffect(() => {
    const unsubscribe = emitter.on(_setThemeStyle);
    return () => {
      unsubscribe();
    };
  }, []);

  return {
    themeStyle,
    setThemeStyle,
  };
}
