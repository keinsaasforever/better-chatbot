"use client";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect } from "react";

export function ExamplePlaceholder({ placeholder }: { placeholder: string[] }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIndex((prev) => (prev + 1) % placeholder.length);
    }, 5000);
    return () => clearTimeout(timer);
  }, [index, placeholder.length]);

  return (
    <div
      className="text-sm text-muted-foreground w-full"
      style={{ position: "relative", minHeight: 20, display: "inline-block" }}
    >
      <AnimatePresence mode="wait">
        <motion.span
          key={index}
          initial={{
            opacity: 0,
            clipPath: "inset(0 100% 0 0)",
          }}
          animate={{
            opacity: 1,
            clipPath: "inset(0 0% 0 0)",
          }}
          exit={{
            opacity: 0,
            clipPath: "inset(0 0% 0 0)",
          }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          style={{ display: "inline-block", position: "absolute" }}
        >
          {placeholder[index]}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}
