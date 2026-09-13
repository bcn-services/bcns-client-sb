/**
 * /library — stub. Item C replaces the panel below with the real
 * Content Library page (sets, upload, media browsing).
 */

import { getDataClient } from "@/lib/data";
import { getSignedInEmail, loadShellData } from "@/lib/header";
import { parseRange, todayInTimezone } from "@/lib/overview";
import { AppHeader, parsePopup } from "@/app/_components/AppHeader";
import { Panel, PanelHead, Unconfigured } from "@/app/_components/Panel";
import { LibraryIcon } from "@/app/_components/icons";

export const dynamic = "force-dynamic";

export default async function LibraryPage({
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
        active="library"
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
        <PanelHead tile={<LibraryIcon />} title="Content Library" />
        <p className="state-note">This page arrives next. The home panel shows your most recent files.</p>
      </Panel>
    </>
  );
}
