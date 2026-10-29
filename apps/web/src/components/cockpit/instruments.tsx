import type { CSSProperties, ReactNode } from "react";
import { cn } from "lib/utils";

/**
 * Flight-deck primitives for /cockpit. Colors follow the Airbus EFIS
 * convention: green = normal/live, amber = caution/INOP, red = failure,
 * cyan = labels/selectable, magenta = targets/paid, white = values.
 */

export const CK = {
  green: "#3df08a",
  amber: "#ffb547",
  red: "#ff4d4d",
  cyan: "#4fd8ff",
  magenta: "#ff5bd1",
  white: "#e8eef2",
  dim: "#8592a0",
  backlight: "#ffc46b",
} as const;

export const MONO: CSSProperties = {
  fontFamily:
    'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace',
};

/** Bezel + black glass screen + title bar. */
export function Display({
  title,
  status,
  statusLabel,
  children,
  className,
}: {
  title: string;
  status: "live" | "inop";
  statusLabel: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-xl bg-gradient-to-b from-[#252a31] to-[#171a1f] p-2 shadow-[0_8px_24px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.06)] ring-1 ring-black",
        className,
      )}
    >
      <div className="relative flex h-full flex-col overflow-hidden rounded-lg bg-[#020405] p-3 shadow-[inset_0_0_24px_rgba(79,216,255,0.06)] ring-1 ring-[#0b1014]">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2
            className="text-xs uppercase tracking-wider"
            style={{ ...MONO, color: CK.cyan }}
          >
            {title}
          </h2>
          <span
            className="rounded-sm px-1.5 py-0.5 text-[10px] tracking-wider ring-1"
            style={{
              ...MONO,
              color: status === "live" ? CK.green : CK.amber,
              boxShadow: `inset 0 0 0 1px ${status === "live" ? CK.green : CK.amber}55`,
            }}
          >
            {statusLabel}
          </span>
        </div>
        <div className="min-h-0 flex-1" style={MONO}>
          {children}
        </div>
      </div>
    </section>
  );
}

/** Label + big value readout used on PFD-style displays. */
export function Readout({
  label,
  value,
  tone = "white",
  sub,
}: {
  label: string;
  value: string;
  tone?: keyof typeof CK;
  sub?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div
        className="truncate text-[11px] uppercase tracking-wide"
        style={{ color: CK.cyan }}
      >
        {label}
      </div>
      <div
        className="text-2xl leading-tight tabular-nums md:text-3xl"
        style={{ color: CK[tone] }}
      >
        {value}
      </div>
      {sub && <div className="text-[11px] tabular-nums">{sub}</div>}
    </div>
  );
}

/** Small "▲ 12%" trend vs previous period. */
export function Trend({
  current,
  previous,
  suffix,
  newLabel,
}: {
  current: number;
  previous: number;
  suffix: string;
  /** Shown instead of a percentage when the previous period was zero. */
  newLabel: string;
}) {
  if (previous === 0) {
    return (
      <span style={{ color: CK.dim }}>
        {current > 0 ? newLabel : "—"} {suffix}
      </span>
    );
  }
  const pct = Math.round(((current - previous) / previous) * 100);
  const up = pct >= 0;
  return (
    <span style={{ color: up ? CK.green : CK.amber }}>
      {up ? "▲" : "▼"} {Math.abs(pct)}%{" "}
      <span style={{ color: CK.dim }}>{suffix}</span>
    </span>
  );
}

/** Amber dashes for an instrument without a data source, Airbus-style. */
export function InopValue({ reason }: { reason?: string }) {
  return (
    <span style={{ color: CK.amber }} title={reason}>
      ---
    </span>
  );
}

/** Glareshield (FCU) window: label above a backlit LCD readout. */
export function FcuWindow({
  label,
  value,
  inop,
}: { label: string; value: string; inop?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-1">
      <div
        className="text-[10px] uppercase tracking-wider"
        style={{ ...MONO, color: CK.backlight }}
      >
        {label}
      </div>
      <div
        className="w-full truncate rounded-sm bg-[#0a0c06] px-2 py-1 text-center text-lg tabular-nums shadow-[inset_0_0_10px_rgba(0,0,0,0.9)] ring-1 ring-black md:text-xl"
        style={{
          ...MONO,
          color: inop ? CK.amber : "#b9ff6b",
          textShadow: inop ? "none" : "0 0 8px rgba(185,255,107,0.55)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

/** Overhead-panel pushbutton with a two-part annunciator legend. */
export function Pushbutton({
  label,
  detail,
  state,
  stateLabel,
  onClick,
  expanded,
  actionLabel,
}: {
  label: string;
  detail: string;
  state: "on" | "fault" | "off";
  stateLabel: string;
  /** Makes the pushbutton a real button (e.g. opens a console). */
  onClick?: () => void;
  expanded?: boolean;
  actionLabel?: string;
}) {
  const color =
    state === "on" ? CK.green : state === "fault" ? CK.amber : CK.dim;
  const capClass =
    "flex aspect-square w-14 flex-col items-center justify-center gap-1 rounded-md bg-gradient-to-b from-[#2b3037] to-[#15181c] shadow-[0_4px_10px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.08)] ring-1 ring-black md:w-16";
  const Cap = onClick ? "button" : "div";
  return (
    <div className="flex min-w-0 flex-col items-center gap-1.5">
      <div
        className="text-[10px] uppercase tracking-wider"
        style={{ ...MONO, color: CK.backlight }}
      >
        {label}
      </div>
      <Cap
        {...(onClick
          ? {
              type: "button" as const,
              onClick,
              "aria-haspopup": "dialog" as const,
              "aria-expanded": expanded ?? false,
              "aria-label": actionLabel
                ? `${actionLabel} (${label}: ${stateLabel})`
                : undefined,
            }
          : {})}
        className={cn(
          capClass,
          onClick &&
            "cursor-pointer transition-transform hover:brightness-125 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4fd8ff]",
        )}
      >
        <span
          className="h-1.5 w-8 rounded-full"
          style={{
            backgroundColor: state === "off" ? "#3a4047" : color,
            boxShadow: state === "off" ? "none" : `0 0 10px ${color}`,
          }}
        />
        <span className="text-[10px] tracking-wider" style={{ ...MONO, color }}>
          {stateLabel}
        </span>
      </Cap>
      <div
        className="max-w-[9rem] text-center text-[10px] leading-tight"
        style={{ color: CK.dim }}
      >
        {detail}
      </div>
    </div>
  );
}

/** MCDU: green-on-black line display with line select keys and a keypad. */
export function McduFrame({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const keys = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  return (
    <section className="rounded-xl bg-gradient-to-b from-[#23272d] to-[#15181c] p-3 shadow-[0_8px_24px_rgba(0,0,0,0.6)] ring-1 ring-black">
      <div className="flex items-stretch gap-2">
        <LskColumn />
        <div
          className="min-w-0 flex-1 rounded-md bg-[#020405] p-3 shadow-[inset_0_0_20px_rgba(61,240,138,0.08)] ring-1 ring-[#0b1014]"
          style={MONO}
        >
          <h2
            className="mb-2 text-center text-sm tracking-wider"
            style={{ ...MONO, color: CK.white }}
          >
            {title}
          </h2>
          {children}
        </div>
        <LskColumn />
      </div>
      <div aria-hidden className="mt-3 grid grid-cols-9 gap-1">
        {keys.map((k) => (
          <span
            key={k}
            className="flex h-5 items-center justify-center rounded-sm bg-[#2c3138] text-[9px] shadow-[inset_0_-1px_0_rgba(0,0,0,0.6)]"
            style={{ ...MONO, color: CK.backlight }}
          >
            {k}
          </span>
        ))}
      </div>
    </section>
  );
}

/** MCDU with static lines; the first line is the amber status line. */
export function Mcdu({ title, lines }: { title: string; lines: string[] }) {
  return (
    <McduFrame title={title}>
      <ol className="space-y-1.5 text-xs">
        {lines.map((line, i) => (
          <li
            key={i}
            className="flex min-h-4 items-center gap-2"
            style={{ color: i === 0 ? CK.amber : CK.green }}
          >
            <span style={{ color: CK.dim }}>
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="truncate">{line || " "}</span>
          </li>
        ))}
      </ol>
    </McduFrame>
  );
}

function LskColumn() {
  return (
    <div aria-hidden className="flex flex-col justify-around gap-1 py-6">
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className="h-3 w-4 rounded-[2px] bg-[#2c3138] shadow-[inset_0_-1px_0_rgba(0,0,0,0.6)]"
        />
      ))}
    </div>
  );
}

/** Daily visits (green line) + leads (magenta bars) mini chart. */
export function FlightPath({
  daily,
  labels,
}: {
  daily: Array<{ day: string; visits: number; leads: number }>;
  labels: { visits: string; leads: string };
}) {
  const w = 300;
  const h = 80;
  const maxVisits = Math.max(1, ...daily.map((d) => d.visits));
  const maxLeads = Math.max(1, ...daily.map((d) => d.leads));
  const step = daily.length > 1 ? w / (daily.length - 1) : w;
  const points = daily
    .map(
      (d, i) =>
        `${(i * step).toFixed(1)},${(h - 6 - (d.visits / maxVisits) * (h - 16)).toFixed(1)}`,
    )
    .join(" ");

  return (
    <figure className="mt-3">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-20 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={`${labels.visits} / ${labels.leads}`}
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={0}
            x2={w}
            y1={h * f}
            y2={h * f}
            stroke="#1b2630"
            strokeWidth={1}
          />
        ))}
        {daily.map((d, i) =>
          d.leads > 0 ? (
            <rect
              key={d.day}
              x={i * step - 2}
              y={h - (d.leads / maxLeads) * (h * 0.45)}
              width={4}
              height={(d.leads / maxLeads) * (h * 0.45)}
              fill={CK.magenta}
              opacity={0.85}
            />
          ) : null,
        )}
        <polyline
          points={points}
          fill="none"
          stroke={CK.green}
          strokeWidth={1.75}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <figcaption className="mt-1 flex gap-4 text-[10px]">
        <span style={{ color: CK.green }}>━ {labels.visits}</span>
        <span style={{ color: CK.magenta }}>▮ {labels.leads}</span>
      </figcaption>
    </figure>
  );
}
