import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";
import EventsTable from "./EventsTable";

export default function SummaryView({ logId }) {
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    apiFetch(`/logs/${logId}/summary`)
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [logId]);

  if (!summary) {
    return <div className="page-container"><p>No summary yet</p></div>;
  }

  return (
    <div className="page-container">
      <h2 style={{ marginBottom: "1.5rem" }}>Log Summary</h2>

      <div className="dashboard-grid">
        {/* Left column: chart */}
        <div className="card">
          <h3>Status Codes</h3>
          <BarChart
            width={400}
            height={200}
            data={Object.entries(summary.countsByStatus).map(([status, count]) => ({
              status,
              count,
            }))}
          >
            <XAxis dataKey="status" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="count" fill="#2563eb" />
          </BarChart>
        </div>

        {/* Right column: stats */}
        <div className="card">
          <h3>Quick Stats</h3>
          <p><strong>Total lines:</strong> {summary.totalLines}</p>
          <p><strong>Unique IPs:</strong> {summary.uniqueIps}</p>

          <h4>Top IPs</h4>
          <ul>
            {summary.topIps.map((ip) => (
              <li key={ip.key}>{ip.key} — {ip.count} requests</li>
            ))}
          </ul>

          <h4>Top Paths</h4>
          <ul>
            {summary.topPaths.map((path) => (
              <li key={path.key}>{path.key} — {path.count} hits</li>
            ))}
          </ul>
        </div>
      </div>
      <div className="card" style={{ marginTop: "2rem" }}>
        <EventsTable logId={logId} />
      </div>
    </div>
  );
}
