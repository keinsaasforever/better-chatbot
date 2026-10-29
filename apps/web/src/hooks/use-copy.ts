"use client";

import { useState } from "react";

export const useCopy = (timeout = 2000) => {
  const [copied, setCopied] = useState(false);

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, timeout);
  };

  return { copied, copy };
};
