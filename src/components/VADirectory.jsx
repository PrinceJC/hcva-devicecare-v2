import { useEffect, useState } from 'react';
import {
  listPeople,
  createPerson,
  updatePerson,
  archivePerson,
} from '../lib/maintenance.js';

const PAGE_SIZE = 20;

const emptyForm = {
  full_name: '',
  email: '',
  stage: 'candidate',
  client_team: '',
};

const stageLabels = {
  candidate: 'Candidate',
  active: 'Active VA',
  inactive: 'Inactive',
};

export default function VADirectory() {
  const [people, setPeople] = useState([]);
  const [form, setForm] = useState({ ...emptyForm });
  const [editingId, setEditingId] = useState(null);
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError('');

    listPeople(page, PAGE_SIZE)
      .then((records) => {
        if (cancelled) return;

        // Return to the previous page if its last record was archived.
        if (records.length === 0 && page > 0) {
          setPage((current) => current - 1);
          return;
        }

        setPeople(records);
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
  }, [page, refresh]);

  function changeField(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  function resetForm() {
    setEditingId(null);
    setForm({ ...emptyForm });
  }

  function startEditing(person) {
    setEditingId(person.id);
    setForm({
      full_name: person.full_name,
      email: person.email,
      stage: person.stage,
      client_team: person.client_team,
    });
    setError('');
    setMessage('');
  }

  async function handleSave(event) {
    event.preventDefault();

    const payload = {
      full_name: form.full_name.trim(),
      email: form.email.trim(),
      stage: form.stage,
      client_team: form.client_team.trim(),
    };

    if (!payload.full_name) {
      setError('Please enter a full name.');
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');

    try {
      if (editingId) {
        await updatePerson(editingId, payload);
      } else {
        await createPerson(payload);
      }

      setMessage(editingId ? 'Record updated.' : 'Team member added.');
      resetForm();
      setPage(0);
      setRefresh((current) => current + 1);
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleArchive(person) {
    const confirmed = window.confirm(
      `Archive ${person.full_name}? Their records and history will be preserved.`
    );

    if (!confirmed) return;

    setBusy(true);
    setError('');
    setMessage('');

    try {
      await archivePerson(person.id);

      if (editingId === person.id) resetForm();

      setMessage(`${person.full_name} was archived.`);
      setRefresh((current) => current + 1);
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="directory">
      <h2>VA directory</h2>
      <p className="muted">
        Register candidates and VAs before adding their devices.
      </p>

      {error && <p className="error" role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}

      <div className="directory-grid">
        <form className="panel" onSubmit={handleSave}>
          <h3>{editingId ? 'Edit team member' : 'Add team member'}</h3>

          <fieldset disabled={busy}>
            <label htmlFor="full_name">Full name</label>
            <input
              id="full_name"
              name="full_name"
              value={form.full_name}
              onChange={changeField}
              maxLength={150}
              required
            />

            <label htmlFor="va_email">Email</label>
            <input
              id="va_email"
              name="email"
              type="email"
              value={form.email}
              onChange={changeField}
            />

            <label htmlFor="stage">Stage</label>
            <select
              id="stage"
              name="stage"
              value={form.stage}
              onChange={changeField}
            >
              <option value="candidate">Candidate</option>
              <option value="active">Active VA</option>
              <option value="inactive">Inactive</option>
            </select>

            <label htmlFor="client_team">Client / team</label>
            <input
              id="client_team"
              name="client_team"
              value={form.client_team}
              onChange={changeField}
            />

            <button type="submit">
              {busy ? 'Saving…' : editingId ? 'Save changes' : 'Add team member'}
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
          <h3>Registered team members</h3>

          {loading ? (
            <p role="status">Loading records…</p>
          ) : error ? (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setRefresh((current) => current + 1)}
            >
              Reload records
            </button>
          ) : (
            <>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Name / email</th>
                      <th>Stage</th>
                      <th>Client / team</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((person) => (
                      <tr key={person.id}>
                        <td>
                          <strong>{person.full_name}</strong>
                          <small>{person.email || 'No email recorded'}</small>
                        </td>
                        <td>{stageLabels[person.stage]}</td>
                        <td>{person.client_team || '—'}</td>
                        <td>
                          <div className="row-actions">
                            <button
                              className="secondary"
                              disabled={busy}
                              onClick={() => startEditing(person)}
                            >
                              Edit
                            </button>
                            <button
                              className="secondary"
                              disabled={busy}
                              onClick={() => handleArchive(person)}
                            >
                              Archive
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}

                    {people.length === 0 && (
                      <tr>
                        <td colSpan={4}>
                          No team members yet. Add your first candidate or VA.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="pagination">
                <button
                  className="secondary"
                  disabled={page === 0 || busy}
                  onClick={() => setPage((current) => current - 1)}
                >
                  Previous
                </button>

                <span>Page {page + 1}</span>

                <button
                  className="secondary"
                  disabled={people.length < PAGE_SIZE || busy}
                  onClick={() => setPage((current) => current + 1)}
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