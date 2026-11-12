import { useEffect, useState } from 'react';
import InspectionForm from './InspectionForm.jsx';
import {
  listPeople,
  listDevices,
  createDevice,
  updateDevice,
  archiveDevice,
} from '../lib/maintenance.js';

const PAGE_SIZE = 20;

const emptyForm = () => ({
  person_id: '',
  model: '',
  asset_tag: '',
  device_type: 'laptop',
  operating_system: '',
  specifications: '',
  notes: '',
  next_due_date: '',
});

async function getAllPeople() {
  const result = [];

  for (let page = 0; ; page += 1) {
    const records = await listPeople(page, 100);
    result.push(...records);

    if (records.length < 100) return result;
  }
}

export default function DeviceInventory() {
  const [people, setPeople] = useState([]);
  const [devices, setDevices] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [inspectionDevice, setInspectionDevice] = useState(null);
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setLoadError('');

    Promise.all([
      getAllPeople(),
      listDevices(page, PAGE_SIZE),
    ])
      .then(([peopleRecords, deviceRecords]) => {
        if (cancelled) return;

        setPeople(peopleRecords);

        if (deviceRecords.length === 0 && page > 0) {
          setPage((current) => current - 1);
          return;
        }

        setDevices(deviceRecords);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [page, refresh]);

  function changeField(event) {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm());
  }

  function editDevice(device) {
    setEditingId(device.id);

    setForm({
      person_id: device.person_id,
      model: device.model,
      asset_tag: device.asset_tag || '',
      device_type: device.device_type,
      operating_system: device.operating_system,
      specifications: device.specifications,
      notes: device.notes,
      next_due_date: device.next_due_date,
    });

    setError('');
    setMessage('');
  }

  async function saveDevice(event) {
    event.preventDefault();

    if (!form.person_id || !form.model.trim()) {
      setError('Select a team member and enter the device model.');
      return;
    }

    const payload = {
      ...form,
      model: form.model.trim(),
      asset_tag: form.asset_tag.trim() || null,
      operating_system: form.operating_system.trim(),
      specifications: form.specifications.trim(),
      notes: form.notes.trim(),
    };

    setBusy(true);
    setError('');
    setMessage('');

    try {
      if (editingId) {
        await updateDevice(editingId, payload);
      } else {
        await createDevice(payload);
      }

      setMessage(
        editingId ? 'Device updated.' : 'Device registered.'
      );

      resetForm();
      setPage(0);
      setRefresh((current) => current + 1);
    } catch (error) {
      setError(
        error.code === '23505'
          ? 'That asset tag is already registered.'
          : error.message
      );
    } finally {
      setBusy(false);
    }
  }

  async function archive(device) {
    const confirmed = window.confirm(
      `Archive ${device.model}? Its history will be preserved.`
    );

    if (!confirmed) return;

    setBusy(true);
    setError('');
    setMessage('');

    try {
      await archiveDevice(device.id);

      if (editingId === device.id) resetForm();

      setMessage('Device archived.');
      setRefresh((current) => current + 1);
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }

  function startInspection(device) {
    resetForm();
    setError('');
    setMessage('');
    setInspectionDevice(device);
  }

  function inspectionSaved(result) {
    setInspectionDevice(null);
    setError('');
    setMessage(result?.hasFailures
      ? 'Inspection saved. Open Action plans to review the draft, set a deadline, and prepare the email.'
      : 'Inspection saved. The next six-month inspection date was updated.');
    setRefresh((current) => current + 1);
  }

  const assignedPersonMissing =
    form.person_id &&
    !people.some((person) => person.id === form.person_id);

  const actionsDisabled = busy || Boolean(inspectionDevice);

  return (
    <section className="directory">
      <h2>Device inventory</h2>

      <p className="muted">
        Register devices, assign them to your team, and complete
        six-month maintenance checks.
      </p>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {message && <p role="status">{message}</p>}

      {inspectionDevice && (
        <InspectionForm
          key={inspectionDevice.id}
          device={inspectionDevice}
          onCancel={() => setInspectionDevice(null)}
          onSaved={inspectionSaved}
        />
      )}

      <div className="directory-grid">
        <form className="panel" onSubmit={saveDevice}>
          <h3>
            {editingId ? 'Edit device' : 'Register device'}
          </h3>

          {!loading && !loadError && people.length === 0 && (
            <p>Add a team member in the VA directory first.</p>
          )}

          <fieldset
            disabled={
              actionsDisabled || loading || Boolean(loadError)
            }
          >
            <label htmlFor="device_person">
              Assigned VA / candidate
            </label>

            <select
              id="device_person"
              name="person_id"
              value={form.person_id}
              onChange={changeField}
              required
            >
              <option value="">Select a team member</option>

              {assignedPersonMissing && (
                <option value={form.person_id}>
                  Archived team member — existing assignment
                </option>
              )}

              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.full_name}
                </option>
              ))}
            </select>

            <label htmlFor="device_model">Brand and model</label>
            <input
              id="device_model"
              name="model"
              value={form.model}
              onChange={changeField}
              placeholder="Lenovo ThinkPad E14"
              maxLength={200}
              required
            />

            <label htmlFor="device_asset">
              Asset tag / serial number
            </label>
            <input
              id="device_asset"
              name="asset_tag"
              value={form.asset_tag}
              onChange={changeField}
              placeholder="HCVA-001"
            />

            <label htmlFor="device_type">Device type</label>
            <select
              id="device_type"
              name="device_type"
              value={form.device_type}
              onChange={changeField}
            >
              <option value="laptop">Laptop</option>
              <option value="desktop">Desktop</option>
              <option value="tablet">Tablet</option>
              <option value="headset">Headset</option>
              <option value="other">Other</option>
            </select>

            <label htmlFor="device_os">Operating system</label>
            <input
              id="device_os"
              name="operating_system"
              value={form.operating_system}
              onChange={changeField}
              placeholder="Windows 11"
            />

            <label htmlFor="device_specs">Specifications</label>
            <input
              id="device_specs"
              name="specifications"
              value={form.specifications}
              onChange={changeField}
              placeholder="16 GB RAM / 512 GB SSD"
            />

            <label htmlFor="device_due">
              Next inspection date
            </label>
            <input
              id="device_due"
              name="next_due_date"
              type="date"
              value={form.next_due_date}
              onChange={changeField}
              required
            />

            <label htmlFor="device_notes">Device notes</label>
            <textarea
              id="device_notes"
              name="notes"
              rows={3}
              value={form.notes}
              onChange={changeField}
            />

            <button type="submit">
              {busy
                ? 'Saving…'
                : editingId
                  ? 'Save changes'
                  : 'Register device'}
            </button>

            {editingId && (
              <button
                type="button"
                className="secondary"
                onClick={resetForm}
              >
                Cancel editing
              </button>
            )}
          </fieldset>
        </form>

        <div className="panel">
          <h3>Registered devices</h3>

          {loading ? (
            <p role="status">Loading devices…</p>
          ) : loadError ? (
            <>
              <p className="error" role="alert">
                {loadError}
              </p>

              <button
                type="button"
                className="secondary"
                disabled={actionsDisabled}
                onClick={() =>
                  setRefresh((current) => current + 1)
                }
              >
                Retry loading
              </button>
            </>
          ) : (
            <>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Device</th>
                      <th>Assigned to</th>
                      <th>Next inspection</th>
                      <th>Actions</th>
                    </tr>
                  </thead>

                  <tbody>
                    {devices.map((device) => (
                      <tr key={device.id}>
                        <td>
                          <strong>{device.model}</strong>

                          <small>
                            {device.asset_tag || 'No asset tag'}
                          </small>

                          <small>
                            {device.operating_system}
                          </small>

                          {device.needs_attention && (
                            <small className="error">
                              Needs attention
                            </small>
                          )}
                        </td>

                        <td>
                          {people.find(
                            (person) =>
                              person.id === device.person_id
                          )?.full_name ||
                            'Archived or unavailable team member'}
                        </td>

                        <td>
                          {device.next_due_date}

                          <small>
                            Last check:{' '}
                            {device.last_inspected_on ||
                              'Not inspected yet'}
                          </small>
                        </td>

                        <td>
                          <div className="row-actions">
                            <button
                              type="button"
                              disabled={actionsDisabled}
                              onClick={() =>
                                startInspection(device)
                              }
                            >
                              Inspect
                            </button>

                            <button
                              type="button"
                              className="secondary"
                              disabled={actionsDisabled}
                              onClick={() => editDevice(device)}
                            >
                              Edit
                            </button>

                            <button
                              type="button"
                              className="secondary"
                              disabled={actionsDisabled}
                              onClick={() => archive(device)}
                            >
                              Archive
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}

                    {devices.length === 0 && (
                      <tr>
                        <td colSpan={4}>
                          No devices yet. Register your first device.
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
                  disabled={page === 0 || actionsDisabled}
                  onClick={() =>
                    setPage((current) => current - 1)
                  }
                >
                  Previous
                </button>

                <span>Page {page + 1}</span>

                <button
                  type="button"
                  className="secondary"
                  disabled={
                    devices.length < PAGE_SIZE ||
                    actionsDisabled
                  }
                  onClick={() =>
                    setPage((current) => current + 1)
                  }
                >
                  Next
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}