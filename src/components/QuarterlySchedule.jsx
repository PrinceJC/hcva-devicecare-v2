import { useEffect, useState } from 'react';
import { listSchedule } from '../lib/maintenance.js';

const PAGE_SIZE = 20;

const statusLabels = {
  overdue: 'Overdue',
  due_soon: 'Due within 30 days',
  on_track: 'On track',
};

function formatDate(value) {
  return new Date(`${value}T12:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function dueDescription(days) {
  if (days < 0) {
    const count = Math.abs(days);
    return `${count} ${count === 1 ? 'day' : 'days'} overdue`;
  }

  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';

  return `Due in ${days} days`;
}

export default function QuarterlySchedule() {
  const [devices, setDevices] = useState([]);
  const [status, setStatus] = useState('');
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError('');

    listSchedule({
      status: status || undefined,
      attentionOnly,
      page,
      size: PAGE_SIZE,
    })
      .then((records) => {
        if (!cancelled) setDevices(records);
      })
      .catch((error) => {
        if (!cancelled) setError(error.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [status, attentionOnly, page, refresh]);

  return (
    <section className="directory">
      <h2>Maintenance Schedule</h2>

    <p className="muted">
  Review upcoming checks and overdue devices. Completing an inspection
  schedules the next check six calendar months later.
</p>

      <div className="panel">
        <label htmlFor="schedule_status">Maintenance status</label>

        <select
          id="schedule_status"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(0);
          }}
        >
          <option value="">All scheduled devices</option>
          <option value="overdue">Overdue</option>
          <option value="due_soon">Due within 30 days</option>
          <option value="on_track">On track</option>
        </select>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <input
            type="checkbox"
            checked={attentionOnly}
            onChange={(event) => {
              setAttentionOnly(event.target.checked);
              setPage(0);
            }}
            style={{ width: 'auto', margin: 0 }}
          />
          Only devices needing attention
        </label>

        <button
          type="button"
          className="secondary"
          disabled={loading}
          onClick={() => setRefresh((current) => current + 1)}
        >
          Refresh schedule
        </button>
      </div>

      <div className="panel" style={{ marginTop: 24 }}>
        <h3>Scheduled device checks</h3>

        {loading ? (
          <p role="status">Loading schedule…</p>
        ) : error ? (
          <p className="error" role="alert">{error}</p>
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>VA / candidate</th>
                    <th>Device</th>
                    <th>Next inspection</th>
                    <th>Status</th>
                  </tr>
                </thead>

                <tbody>
                  {devices.map((device) => (
                    <tr key={device.id}>
                      <td>
                        <strong>{device.full_name}</strong>
                        <small>
                          {{
                            candidate: 'Candidate',
                            active: 'Active VA',
                            inactive: 'Inactive',
                          }[device.stage] || device.stage}
                        </small>
                      </td>

                      <td>
                        <strong>{device.model}</strong>
                        <small>
                          {device.asset_tag || 'No asset tag'}
                        </small>
                      </td>

                      <td>
                        {formatDate(device.next_due_date)}

                        <small
                          className={
                            device.schedule_status === 'overdue'
                              ? 'error'
                              : ''
                          }
                        >
                          {dueDescription(device.days_until_due)}
                        </small>
                      </td>

                      <td>
                        <strong
                          className={
                            device.schedule_status === 'overdue'
                              ? 'error'
                              : ''
                          }
                        >
                          {statusLabels[device.schedule_status]}
                        </strong>

                        {device.needs_attention && (
                          <small className="error">
                            Needs attention
                          </small>
                        )}
                      </td>
                    </tr>
                  ))}

                  {devices.length === 0 && (
                    <tr>
                      <td colSpan={4}>
                        No devices match this page and these filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="pagination">
              <button
                type="button"
                className="secondary"
                disabled={page === 0}
                onClick={() => setPage((current) => current - 1)}
              >
                Previous
              </button>

              <span>Page {page + 1}</span>

              <button
                type="button"
                className="secondary"
                disabled={devices.length < PAGE_SIZE}
                onClick={() => setPage((current) => current + 1)}
              >
                Next
              </button>
            </div>
          </>
        )}
      </div>

      <p className="muted">
        Dates use Manila time. Archived devices and devices assigned to
        archived team members are excluded. This screen tracks dates;
        automatic email reminders are not connected yet.
      </p>
    </section>
  );
}