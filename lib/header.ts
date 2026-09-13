/**
 * header.ts — the one read every page needs before it can render the shell:
 * the client's name and timezone (client_v1, which also sets "today" for the
 * date range) and connector_health_v1, which drives both the Integrations
 * popup and each panel's not-connected state.
 *
 * Not pure, so it stays out of tests/*.test.mjs; the logic it feeds lives in
 * lib/panels.ts and lib/overview.ts.
 */

import type { DataClient } from "@bcn-services/data-client";
import type { HealthLike } from "./panels";

export const DEFAULT_TIMEZONE = "America/New_York";

export interface ShellData {
  clientName: string | null;
  timezone: string;
  health: HealthLike[];
  healthError: boolean;
}

export async function loadShellData(client: DataClient): Promise<ShellData> {
  const [clientR, healthR] = await Promise.allSettled([
    client.views.client_v1("name,timezone").single(),
    client.views.connector_health_v1("source,status,last_success_at,last_error"),
  ]);

  let clientName: string | null = null;
  let timezone = DEFAULT_TIMEZONE;
  if (clientR.status === "fulfilled" && !clientR.value.error && clientR.value.data) {
    const row = clientR.value.data as { name?: string | null; timezone?: string | null };
    clientName = row.name ?? null;
    if (row.timezone) timezone = row.timezone;
  } else {
    console.error("shell: client_v1 read failed", clientR.status === "rejected" ? clientR.reason : clientR.value.error);
  }

  let health: HealthLike[] = [];
  let healthError = false;
  if (healthR.status === "fulfilled" && !healthR.value.error) {
    health = (healthR.value.data ?? []) as HealthLike[];
  } else {
    healthError = true;
    console.error("shell: connector_health_v1 read failed", healthR.status === "rejected" ? healthR.reason : healthR.value.error);
  }

  return { clientName, timezone, health, healthError };
}

/** The signed-in address for the Settings popup. middleware.ts already
 *  verified the session with getUser() for this request, so reading the
 *  cookie session here costs no extra auth round trip. */
export async function getSignedInEmail(): Promise<string | null> {
  const { createSupabaseServer } = await import("./supabase-server");
  const supabase = createSupabaseServer();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user.email ?? null;
}
