import { AI_CHANNELS, CHANNEL_LABELS } from "lib/cockpit/channels";
import type { ChannelRow } from "lib/cockpit/types";
import { CK } from "./instruments";

const PAID = new Set(["google_ads", "linkedin_ads", "reddit_ads", "meta_ads"]);

export function colorFor(channel: ChannelRow["channel"]): string {
  if (PAID.has(channel)) return CK.magenta;
  if (AI_CHANNELS.includes(channel)) return CK.green;
  if (channel === "direct") return CK.white;
  return CK.cyan;
}

/**
 * Navigation-display style channel radar: each channel gets a bearing on the
 * compass rose, the vector length is its share of visits.
 * Magenta = paid, green = AI assistants, cyan = organic/social, white = direct.
 */
export function ChannelNd({
  channels,
  totalVisits,
  leadsSuffix,
  ariaLabel,
}: {
  channels: ChannelRow[];
  totalVisits: number;
  leadsSuffix: string;
  ariaLabel: string;
}) {
  const size = 260;
  const c = size / 2;
  const r = c - 26;
  const shown = channels.slice(0, 10);
  const maxShare = Math.max(
    0.0001,
    ...shown.map((ch) => ch.visits / Math.max(1, totalVisits)),
  );

  return (
    <div className="flex flex-col gap-3">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="mx-auto h-auto w-full max-w-[280px]"
        role="img"
        aria-label={ariaLabel}
      >
        {[1, 0.66, 0.33].map((f) => (
          <circle
            key={f}
            cx={c}
            cy={c}
            r={r * f}
            fill="none"
            stroke={f === 1 ? "#e8eef2" : "#1d2a33"}
            strokeWidth={f === 1 ? 1 : 0.75}
            strokeDasharray={f === 1 ? undefined : "2 4"}
          />
        ))}
        {Array.from({ length: 36 }, (_, i) => {
          const a = (i * 10 * Math.PI) / 180;
          const long = i % 3 === 0;
          const r1 = r - (long ? 8 : 4);
          return (
            <line
              key={i}
              x1={c + Math.sin(a) * r1}
              y1={c - Math.cos(a) * r1}
              x2={c + Math.sin(a) * r}
              y2={c - Math.cos(a) * r}
              stroke="#e8eef2"
              strokeWidth={long ? 1 : 0.6}
            />
          );
        })}
        {["N", "E", "S", "W"].map((label, i) => {
          const a = (i * 90 * Math.PI) / 180;
          return (
            <text
              key={label}
              x={c + Math.sin(a) * (r - 16)}
              y={c - Math.cos(a) * (r - 16) + 3}
              fill="#e8eef2"
              fontSize={9}
              textAnchor="middle"
            >
              {label}
            </text>
          );
        })}
        {shown.map((ch, i) => {
          const a = (i / Math.max(1, shown.length)) * 2 * Math.PI;
          const share = ch.visits / Math.max(1, totalVisits);
          const len = 12 + (share / maxShare) * (r - 30);
          const x = c + Math.sin(a) * len;
          const y = c - Math.cos(a) * len;
          const color = colorFor(ch.channel);
          return (
            <g key={ch.channel}>
              <line
                x1={c}
                y1={c}
                x2={x}
                y2={y}
                stroke={color}
                strokeWidth={1.5}
                opacity={0.9}
              />
              <path
                d={`M ${x} ${y - 4} L ${x + 4} ${y} L ${x} ${y + 4} L ${x - 4} ${y} Z`}
                fill="none"
                stroke={color}
                strokeWidth={1.25}
              />
            </g>
          );
        })}
        {/* Own aircraft symbol */}
        <path
          d={`M ${c} ${c - 9} L ${c} ${c + 9} M ${c - 9} ${c - 1} L ${c + 9} ${c - 1} M ${c - 4} ${c + 7} L ${c + 4} ${c + 7}`}
          stroke="#ffd447"
          strokeWidth={2.25}
          strokeLinecap="round"
        />
      </svg>
      <ul className="grid grid-cols-1 gap-1 text-[11px]">
        {shown.map((ch) => {
          const pct =
            totalVisits > 0 ? Math.round((ch.visits / totalVisits) * 100) : 0;
          return (
            <li
              key={ch.channel}
              className="flex items-center justify-between gap-2"
            >
              <span
                className="truncate uppercase"
                style={{ color: colorFor(ch.channel) }}
              >
                {CHANNEL_LABELS[ch.channel]}
              </span>
              <span
                className="shrink-0 tabular-nums"
                style={{ color: CK.white }}
              >
                {pct}%{" "}
                <span style={{ color: CK.magenta }}>
                  {ch.leads > 0 ? `· ${ch.leads} ${leadsSuffix}` : ""}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
