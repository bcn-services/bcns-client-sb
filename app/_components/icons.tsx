/**
 * icons.tsx — inline SVG copied from design/Saunaboy Command Center.dc.html.
 * No icon dependency: the artboard's paths are the source of truth.
 */

export function IntegrationsIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="8" height="8" rx="2" />
      <rect x="13" y="13" width="8" height="8" rx="2" />
      <path d="M11 7h4a2 2 0 0 1 2 2v4" />
    </svg>
  );
}

export function SettingsIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" />
      <circle cx="12" cy="12" r="8.4" strokeDasharray="3 3.4" />
    </svg>
  );
}

export function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
      <path d="M3 9.5h18M8 3v3M16 3v3" />
    </svg>
  );
}

export function ChevronDownIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--text-placeholder)" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function MetaIcon({ width = 19, height = 14, strokeWidth = 2.4 }: { width?: number; height?: number; strokeWidth?: number }) {
  return (
    <svg width={width} height={height} viewBox="0 0 24 16" fill="none" stroke="#1877f2" strokeWidth={strokeWidth} aria-hidden="true">
      <path d="M2 12c1.5-8 5-10 7-6s3.5 10 6 10 4-4 4-8-2-6-4-4" />
    </svg>
  );
}

export function FinanceIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="var(--accent)" aria-hidden="true">
      <rect x="3" y="12" width="4" height="9" rx="1" />
      <rect x="10" y="7" width="4" height="14" rx="1" />
      <rect x="17" y="3" width="4" height="18" rx="1" />
    </svg>
  );
}

export function MeetIcon({ width = 17, height = 13 }: { width?: number; height?: number }) {
  return (
    <svg width={width} height={height} viewBox="0 0 24 18" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="13" height="14" rx="2.5" fill="#4285f4" />
      <path d="M16 7l6-4v12l-6-4z" fill="#34a853" />
    </svg>
  );
}

export function MondayDots() {
  return (
    <>
      <span className="monday-dot" style={{ background: "#f2545b" }} />
      <span className="monday-dot" style={{ background: "#ffcb00" }} />
      <span className="monday-dot" style={{ background: "#00c875" }} />
    </>
  );
}

export function LibraryIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.9" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M3 15l5-4 4 3 3-2 6 4" />
    </svg>
  );
}

export function ActivityIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12h4l2-6 3 12 2.5-7 1.5 4h5" />
    </svg>
  );
}

export function NoteIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="1.8" aria-hidden="true">
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M9 12h6M9 16h6" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--up)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.6 2.6L16 9.5" />
    </svg>
  );
}

/** Brand tile for a source, used by Recent Activity rows. */
export function SourceTile({ source }: { source: string | null | undefined }) {
  switch (source) {
    case "shopify":
      return <span className="source-tile source-tile--shopify">S</span>;
    case "meta":
      return (
        <span className="source-tile source-tile--meta">
          <MetaIcon width={15} height={11} strokeWidth={2.6} />
        </span>
      );
    case "meet":
    case "drive":
      return (
        <span className="source-tile source-tile--meet">
          <MeetIcon width={14} height={11} />
        </span>
      );
    case "monday":
    case "dashboard":
    case "upload":
      return (
        <span className="source-tile source-tile--accent">
          <FinanceIcon size={14} />
        </span>
      );
    default:
      return (
        <span className="source-tile source-tile--ok">
          <CheckIcon />
        </span>
      );
  }
}
