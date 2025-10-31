import { useEffect, useState } from "react";
import { apiFetch } from "../api";

export default function EventsTable({ logId }) {
  const [events, setEvents] = useState([]);
  const [page, setPage] = useState(1);
  const [limit] = useState(10); // number of rows per page
  const [statusFilter, setStatusFilter] = useState("");
  const [ipFilter, setIpFilter] = useState("");
  const [total, setTotal] = useState(0);

  async function fetchEvents() {
    let query = `?page=${page}&limit=${limit}`;
    if (statusFilter) query += `&status=${statusFilter}`;
    if (ipFilter) query += `&ip=${ipFilter}`;

    try {
      const data = await apiFetch(`/logs/${logId}/events${query}`);
      setEvents(data.items);
      setTotal(data.total);
    } catch (err) {
      console.error("Failed to fetch events:", err);
    }
  }

  useEffect(() => {
    fetchEvents();
  }, [page, statusFilter, ipFilter, logId]);

  return (
    <div className="container">
      <h3>Log Events</h3>

      {/* Filters */}
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
        <input
          type="text"
          placeholder="Filter by Status (e.g. 404)"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        />
        <input
          type="text"
          placeholder="Filter by IP"
          value={ipFilter}
          onChange={(e) => setIpFilter(e.target.value)}
        />
        <button onClick={() => { setPage(1); fetchEvents(); }}>
          Apply Filters
        </button>
      </div>

      {/* Table */}
      <table border="1" cellPadding="8" cellSpacing="0" style={{ width: "100%", marginBottom: "1rem" }}>
        <thead>
          <tr>
            <th>IP</th>
            <th>Time</th>
            <th>Method</th>
            <th>Path</th>
            <th>Status</th>
            <th>Bytes</th>
          </tr>
        </thead>
        <tbody>
          {events.length === 0 ? (
            <tr>
              <td colSpan="6" style={{ textAlign: "center" }}>No events found</td>
            </tr>
          ) : (
            events.map((ev, idx) => (
              <tr key={idx}>
                <td>{ev.ip}</td>
                <td>{ev.time}</td>
                <td>{ev.method}</td>
                <td>{ev.path}</td>
                <td>{ev.status}</td>
                <td>{ev.bytes}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* Pagination */}
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <button
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
        >
          Previous
        </button>
        <span>Page {page}</span>
        <button
          disabled={page * limit >= total}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
