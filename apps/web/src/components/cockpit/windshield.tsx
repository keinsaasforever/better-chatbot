"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

// WebGL only exists in the browser; the CSS gradient below doubles as the
// loading state and as the fallback when WebGL is unavailable.
const CockpitScene = dynamic(() => import("./cockpit-scene"), { ssr: false });

export function Windshield() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return (
    <div
      className="absolute inset-0"
      style={{
        background:
          "radial-gradient(ellipse 18% 30% at 50% 58%, #ffd9a0 0%, #ff8a3a 18%, rgba(120,40,10,0.35) 45%, transparent 70%), radial-gradient(ellipse 120% 80% at 50% 60%, #0b1022 0%, #04060d 60%, #010205 100%)",
      }}
    >
      <CockpitScene reducedMotion={reducedMotion} />
    </div>
  );
}
