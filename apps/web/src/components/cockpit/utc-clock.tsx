"use client";

import { useEffect, useState } from "react";

/** Ticking UTC clock (rendered empty on the server to avoid a hydration mismatch). */
export function UtcClock() {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date().toISOString().slice(11, 19));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);
  return <span className="tabular-nums">{now ?? "--:--:--"}</span>;
}
