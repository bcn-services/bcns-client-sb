/**
 * MetricCard.tsx — the six home tiles: label, value, delta, sparkline.
 * Extracted from app/page.tsx so the tiles are one definition, not six.
 */

import { Delta } from "./Panel";

const VIEW_W = 200;
const VIEW_H = 34;
const PAD = 4;

export function Sparkline({ series }: { series: { day: string; value: number }[] }) {
  if (series.length < 2) return <div className="sparkline sparkline--empty" aria-hidden="true" />;
  const values = series.map((s) => s.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const usable = VIEW_H - PAD * 2;
  const points = series
    .map((s, i) => {
      const x = (i / (series.length - 1)) * VIEW_W;
      const y = VIEW_H - PAD - ((s.value - min) / span) * usable;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg className="sparkline" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke="var(--sparkline)" strokeWidth="1.8" />
    </svg>
  );
}

export function MetricCard({
  label,
  value,
  deltaPct,
  series,
  hasData,
}: {
  label: string;
  value: string;
  deltaPct: number | null;
  series: { day: string; value: number }[];
  hasData: boolean;
}) {
  return (
    <div className="metric-card">
      <div className="metric-card__label">{label}</div>
      <div className="metric-card__value-row">
        <span className="metric-card__value">{hasData ? value : "—"}</span>
        {hasData ? <Delta deltaPct={deltaPct} /> : null}
      </div>
      {hasData ? <Sparkline series={series} /> : <div className="sparkline sparkline--empty" aria-hidden="true" />}
    </div>
  );
}
