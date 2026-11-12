import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

const PAGE_SIZE = 20;

function formatDate(value) {
  if (!value) return '—';

  return new Date(`${value}T12:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

async function getDeviceOptions() {
  const devices = [];

  // Include archived devices so their history remains accessible.
  for (let page = 0; ; page += 1) {
    const { data, error } = await supabase
      .from('devices')
      .select('id, model, asset_tag, archived')
      .order('model')
      .order('id')
      .range(page * 100, page * 100 + 99);

    if (error) throw error;

    devices.push(...data);

    if (data.length < 100) return devices;
  }
}

export default function InspectionHistory() {
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState('');
  const [reports, setReports] = useState([]);
  const [selectedReport, setSelectedReport] = useState(null);
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deviceError, setDeviceError] = useState('');

  useEffect(() => {
    let cancelled = false;

    setDeviceError('');

    getDeviceOptions()
      .then((records) => {
        if (!cancelled) setDevices(records);
      })
      .catch((error) => {
        if (!cancelled) setDeviceError(error.message);
      });

    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError('');

    async function loadReports() {
      let request = supabase
        .from('inspections')
        .select('*');

      if (deviceId) {
        request = request.eq('device_id', deviceId);
      }

      const { data, error } = await request
        .order('inspected_on', { ascending: false })
        .order('created_at', { ascending: false })
        .order('id')
        .range(
          page * PAGE_SIZE,
          page * PAGE_SIZE + PAGE_SIZE - 1
        );

      if (error) throw error;

      if (!cancelled) setReports(data);
    }

    loadReports()
      .catch((error) => {
        if (!cancelled) setError(error.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [deviceId, page, refresh]);

  function changeDevice(event) {
    setDeviceId(event.target.value);
    setPage(0);
    setSelectedReport(null);
  }

  return (
    <section className="directory">
      <h2>Inspection history</h2>

      <p className="muted">
        Review completed maintenance checks and recorded findings.
      </p>

      <div className="panel">
        <label htmlFor="history_device">Filter by device</label>

        <select
          id="history_device"
          value={deviceId}
          onChange={changeDevice}
        >
          <option value="">All devices</option>

          {devices.map((device) => (
            <option key={device.id} value={device.id}>
              {device.model}
              {device.asset_tag ? ` · ${device.asset_tag}` : ''}
              {device.archived ? ' (Archived)' : ''}
            </option>
          ))}
        </select>

        {deviceError && (
          <p className="error" role="alert">
            Could not load the device filter: {deviceError}
          </p>
        )}

        <button
          type="button"
          className="secondary"
          disabled={loading}
          onClick={() => setRefresh((current) => current + 1)}
        >
          Refresh history
        </button>
      </div>

      {selectedReport && (
        <div className="panel" style={{ marginTop: 24 }}>
          <h3>Inspection report</h3>

          <p>
            <strong>VA / candidate:</strong>{' '}
            {selectedReport.person_name_snapshot}
          </p>

          <p>
            <strong>Device:</strong>{' '}
            {selectedReport.device_model_snapshot}
          </p>

          <p>
            <strong>Inspection date:</strong>{' '}
            {formatDate(selectedReport.inspected_on)}
          </p>

          <p>
            <strong>Next date scheduled by this inspection:</strong>{' '}
            {formatDate(selectedReport.next_due_date)}
          </p>

          <p className={selectedReport.has_failures ? 'error' : ''}>
            <strong>Result:</strong>{' '}
            {selectedReport.has_failures
              ? 'Issues found'
              : 'Completed without failed checks'}
          </p>

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Checklist item</th>
                  <th>Result</th>
                </tr>
              </thead>

              <tbody>
                {Object.entries(selectedReport.results).map(
                  ([code, check]) => (
                    <tr key={code}>
                      <td>
                        <strong>{check.title}</strong>
                        <small>{check.description}</small>
                      </td>

                      <td className={check.result === 'fail' ? 'error' : ''}>
                        {{
                          pass: 'Pass',
                          fail: 'Fail',
                          na: 'Not applicable',
                        }[check.result] || check.result}
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>

          <h3 style={{ marginTop: 24 }}>
            Findings and follow-up actions
          </h3>

          <p style={{ whiteSpace: 'pre-wrap' }}>
            {selectedReport.findings || 'No additional findings recorded.'}
          </p>

          <button
            type="button"
            className="secondary"
            onClick={() => setSelectedReport(null)}
          >
            Close report
          </button>
        </div>
      )}

      <div className="panel" style={{ marginTop: 24 }}>
        <h3>Completed inspections</h3>

        {loading ? (
          <p role="status">Loading inspection history…</p>
        ) : error ? (
          <p className="error" role="alert">{error}</p>
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>VA / device</th>
                    <th>Result</th>
                    <th>Report</th>
                  </tr>
                </thead>

                <tbody>
                  {reports.map((report) => (
                    <tr key={report.id}>
                      <td>{formatDate(report.inspected_on)}</td>

                      <td>
                        <strong>{report.person_name_snapshot}</strong>
                        <small>{report.device_model_snapshot}</small>
                      </td>

                      <td className={report.has_failures ? 'error' : ''}>
                        {report.has_failures
                          ? 'Issues found'
                          : 'Completed'}
                      </td>

                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => setSelectedReport(report)}
                          >
                            View report
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}

                  {reports.length === 0 && (
                    <tr>
                      <td colSpan={4}>
                        No inspections found on this page.
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
                onClick={() => {
                  setSelectedReport(null);
                  setPage((current) => current - 1);
                }}
              >
                Previous
              </button>

              <span>Page {page + 1}</span>

              <button
                type="button"
                className="secondary"
                disabled={reports.length < PAGE_SIZE}
                onClick={() => {
                  setSelectedReport(null);
                  setPage((current) => current + 1);
                }}
              >
                Next
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}