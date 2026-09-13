/**
 * /financials — stub. Item B replaces the panel below with the real
 * Financial Information page (manual expense figures + the full breakdown).
 */

import { getDataClient } from "@/lib/data";
import { getSignedInEmail, loadShellData } from "@/lib/header";
import { parseRange, todayInTimezone } from "@/lib/overview";
import { AppHeader, parsePopup } from "@/app/_components/AppHeader";
import { Panel, PanelHead, Unconfigured } from "@/app/_components/Panel";
import { FinanceIcon } from "@/app/_components/icons";

export const dynamic = "force-dynamic";

export default async function FinancialsPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; popup?: string };
}) {
  const client = await getDataClient();
  if (!client) return <Unconfigured />;

  const [shell, email] = await Promise.all([loadShellData(client), getSignedInEmail()]);
  const today = todayInTimezone(shell.timezone);
  const range = parseRange(searchParams, today);

  return (
    <>
      <AppHeader
        active="financials"
        range={range}
        today={today}
        clientName={shell.clientName}
        timezone={shell.timezone}
        email={email}
        health={shell.health}
        healthError={shell.healthError}
        openPopup={parsePopup(searchParams.popup)}
      />
      <Panel>
        <PanelHead tile={<FinanceIcon />} title="Financial Information" />
        <p className="state-note">This page arrives next. The home panel shows the current totals.</p>
      </Panel>
    </>
  );
}
