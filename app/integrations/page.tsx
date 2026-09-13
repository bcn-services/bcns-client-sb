import { getDataClient } from "@/lib/data";

export const dynamic = "force-dynamic";

const EXPECTED_SOURCES = [
  { source: "shopify", label: "Shopify" },
  { source: "meta", label: "Meta Ads" },
  { source: "monday", label: "Monday.com" },
  { source: "meet", label: "Google Meet" },
  { source: "drive", label: "Google Drive" },
] as const;

export default async function IntegrationsPage() {
  const client = await getDataClient();
  if (!client) {
    return (
      <>
        <div className="page-header">
          <h2>Integrations</h2>
        </div>
        <p className="notice">Not connected to the data platform.</p>
      </>
    );
  }

  const { data, error } = await client.views.connector_health_v1();
  if (error) console.error("integrations: connector_health_v1 read failed", error instanceof Error ? error.message : error);

  const bySource = new Map((data ?? []).map((row) => [row.source, row]));

  return (
    <>
      <div className="page-header">
        <h2>Integrations</h2>
      </div>
      <section className="panel">
        {error ? (
          <p className="error-state">Couldn&apos;t load integration status.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Status</th>
                <th>Last success</th>
                <th>Last error</th>
              </tr>
            </thead>
            <tbody>
              {EXPECTED_SOURCES.map(({ source, label }) => {
                const health = bySource.get(source);
                if (!health) {
                  return (
                    <tr key={source}>
                      <td>{label}</td>
                      <td colSpan={3} className="empty-state">
                        Not connected
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={source}>
                    <td>{label}</td>
                    <td>
                      <span className={`badge ${health.status ?? ""}`}>{health.status ?? "unknown"}</span>
                    </td>
                    <td>{health.last_success_at ?? "—"}</td>
                    <td>{health.last_error ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
