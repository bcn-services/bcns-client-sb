/**
 * Panel.tsx — the panel anatomy DESIGN.md describes once and every home card
 * reuses: white card, brand-tile header, label/value/delta rows, full-width
 * accent button, and the three states (not connected / empty / data).
 */

import Link from "next/link";
import { deltaTone, formatDeltaArrow } from "@/lib/overview";
import type { PanelState } from "@/lib/panels";
import { EXTERNAL_LINK_PROPS } from "@/lib/links";

export function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`panel ${className}`.trim()}>{children}</section>;
}

export function PanelHead({
  tile,
  title,
  small = false,
  right,
}: {
  tile: React.ReactNode;
  title: string;
  small?: boolean;
  right?: React.ReactNode;
}) {
  return (
    <div className="panel__head">
      <div className="panel__ident">
        <span className="brand-tile">{tile}</span>
        <h2 className={small ? "panel__title panel__title--sm" : "panel__title"}>{title}</h2>
      </div>
      {right ?? null}
    </div>
  );
}

export function Delta({ deltaPct }: { deltaPct: number | null }) {
  return <span className={`delta delta--${deltaTone(deltaPct)}`}>{formatDeltaArrow(deltaPct)}</span>;
}

export function DataRow({
  label,
  value,
  deltaPct,
  variant = "default",
}: {
  label: string;
  value: string;
  deltaPct: number | null;
  variant?: "default" | "tight" | "roomy";
}) {
  return (
    <div className={`row row--${variant}`}>
      <span className="row__label">{label}</span>
      <span className="row__value">{value}</span>
      <Delta deltaPct={deltaPct} />
    </div>
  );
}

/** "View All  →" — the accent text link in a panel's subheader. */
export function ViewAll({ href, external = false }: { href: string; external?: boolean }) {
  const label = "View All  →";
  if (external) {
    return (
      <a className="view-all" href={href} {...EXTERNAL_LINK_PROPS}>
        {label}
      </a>
    );
  }
  return (
    <Link className="view-all" href={href}>
      {label}
    </Link>
  );
}

/** Full-width accent button at the foot of a panel. */
export function PanelButton({ href, label, external = false }: { href: string; label: string; external?: boolean }) {
  const text = `${label}  →`;
  if (external) {
    return (
      <a className="btn-accent" href={href} {...EXTERNAL_LINK_PROPS}>
        {text}
      </a>
    );
  }
  return (
    <Link className="btn-accent" href={href}>
      {text}
    </Link>
  );
}

/** The not-connected / empty copy. `connectHref` re-renders the page with the
 *  Integrations popup open (server-driven, so no client JS is needed). */
export function StateNote({
  state,
  label,
  connectHref,
}: {
  state: Exclude<PanelState, "data">;
  label: string;
  connectHref: string;
}) {
  if (state === "not_connected") {
    return (
      <p className="state-note">
        Not connected yet.{" "}
        <Link className="state-note__link" href={connectHref}>
          Connect {label}
        </Link>
      </p>
    );
  }
  return <p className="state-note">No data for this range.</p>;
}

/** Shown when lib/data.ts has no client — no Supabase env, or signed out. */
export function Unconfigured() {
  return (
    <Panel>
      <p className="state-note">Not connected to the data platform.</p>
    </Panel>
  );
}
