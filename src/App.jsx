import { lazy, Suspense, useEffect, useState } from "react";
import { signIn, signOut } from "./lib/maintenance.js";
import useAdminSession from "./hooks/useAdminSession.js";
import Icon from "./components/Icon.jsx";
import Dashboard from "./components/Dashboard.jsx";
import IncidentLog from "./components/IncidentLog.jsx";
import "./incidents.css";
import VADirectory from "./components/VADirectory.jsx";
import DeviceInventory from "./components/DeviceInventory.jsx";
import InspectionHistory from "./components/InspectionHistory.jsx";
import QuarterlySchedule from "./components/QuarterlySchedule.jsx";
import "./styles.css";
const ActionPlans = lazy(() => import("./components/ActionPlans.jsx"));
const EmailSettings = lazy(() => import("./components/EmailSettings.jsx"));
import "./actions.css";

const sections = [
  { id: "dashboard", label: "Dashboard" },
  { id: "people", label: "VA directory" },
  { id: "devices", label: "Device inventory" },
  { id: "schedule", label: "Maintenance schedule" },
  { id: "history", label: "Inspection history" },
  { id: "incidents", label: "Incident log" },
  { id: "actions", label: "Action plans" },
  { id: "emailsettings", label: "Email settings" },
];

function savedSection() {
  try {
    const value = sessionStorage.getItem("hcva-devicecare-section");
    return sections.some((section) => section.id === value)
      ? value
      : "dashboard";
  } catch {
    return "dashboard";
  }
}

function Brand({ large = false }) {
  return (
    <div className={`brand ${large ? "brand-large" : ""}`}>
      <span className="brand-mark">
        <img src="/hcva-logomark-colored.png" alt="HCVA logo" />
      </span>
      <span>
        <strong>DeviceCare</strong>
        <small>HIGHCALL VIRTUAL ASSISTANTS</small>
      </span>
    </div>
  );
}

export default function App() {
  const {
    session,
    status,
    error: sessionError,
    retryAccess,
  } = useAdminSession();
  const [selectedActionPlan, setSelectedActionPlan] = useState(null);
  const [activeTab, setActiveTab] = useState(savedSection);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    try {
      sessionStorage.setItem("hcva-devicecare-section", activeTab);
    } catch {
      /* Navigation still works without storage. */
    }
  }, [activeTab]);

  function navigate(id) {
    setSelectedActionPlan(null);
    setActiveTab(id);
    setMenuOpen(false);
  }

  async function handleLogin(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setError("");
    try {
      await signIn(
        String(values.get("email")).trim(),
        String(values.get("password")),
      );
      form.reset();
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    setBusy(true);
    setError("");
    try {
      await signOut();
      navigate("dashboard");
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }

  if (status !== "admin") {
    return (
      <div className="auth-layout">
        <section className="auth-story">
          <Brand large />
          <div className="auth-story-content">
            <span className="eyebrow">HCVA IT WORKSPACE</span>
            <h1>
              A healthier device.
              <br />A smoother workday.
            </h1>
            <p>
              Keep your virtual assistants connected, supported, and ready for
              every workday.
            </p>
            <div className="auth-benefits">
              <span>
                <Icon name="check" /> One home for every device
              </span>
              <span>
                <Icon name="check" /> A consistent six-month routine
              </span>
              <span>
                <Icon name="check" /> Clear inspection history
              </span>
            </div>
          </div>
          <small className="auth-story-footer">
            Care for your devices. Support your people.
          </small>
        </section>
        <main className="auth-main">
          <div className="auth-card">
            <div className="auth-mobile-brand">
              <Brand />
            </div>
            {status === "loading" || status === "checking" ? (
              <>
                <span className="auth-symbol">
                  <Icon name="shield" />
                </span>
                <h2>Opening your workspace</h2>
                <p className="muted" role="status">
                  Restoring your session and verifying access…
                </p>
              </>
            ) : status === "signed-out" ? (
              <>
                <span className="eyebrow">WELCOME TO DEVICECARE</span>
                <h2>Sign in to your workspace</h2>
                <p className="muted">
                  Manage your team's preventive maintenance.
                </p>
                <form onSubmit={handleLogin}>
                  <label htmlFor="email">Work email</label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="username"
                    placeholder="you@highcallva.com"
                    required
                    disabled={busy}
                  />
                  <label htmlFor="password">Password</label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    required
                    disabled={busy}
                  />
                  <button className="auth-submit" disabled={busy}>
                    {busy ? (
                      "Signing in…"
                    ) : (
                      <>
                        Sign in <Icon name="arrow" />
                      </>
                    )}
                  </button>
                </form>
                <p className="auth-help">
                  Need an account or password assistance? Contact your HCVA IT
                  administrator.
                </p>
              </>
            ) : (
              <>
                <span className="auth-symbol">
                  <Icon name="shield" />
                </span>
                <h2>
                  {status === "denied"
                    ? "Admin access required"
                    : "Could not verify access"}
                </h2>
                <p className="muted">Signed in as {session?.user?.email}.</p>
                <p>
                  {status === "denied"
                    ? "This workspace is currently for IT administrators. Contact your administrator if you need access."
                    : "Check your connection and try again."}
                </p>
                <button onClick={retryAccess} disabled={busy}>
                  Retry access check
                </button>
                <button
                  className="secondary"
                  onClick={handleLogout}
                  disabled={busy}
                >
                  Sign out
                </button>
              </>
            )}
            {(error || sessionError) && (
              <p className="error message" role="alert">
                {error || sessionError}
              </p>
            )}
            <div className="auth-footnote">
              <Icon name="shield" /> Access protected by Supabase authentication
            </div>
          </div>
        </main>
      </div>
    );
  }

  const current =
    sections.find((section) => section.id === activeTab) || sections[0];
  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? "is-open" : ""}`}>
        <Brand />
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {sections.map((section) => (
            <button
              type="button"
              key={section.id}
              className={activeTab === section.id ? "active" : ""}
              aria-current={activeTab === section.id ? "page" : undefined}
              onClick={() => navigate(section.id)}
            >
              <Icon name={section.id} />
              {section.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="care-card">
            <Icon name="schedule" />
            <strong>A little care. A longer life.</strong>
            <p>A six-month routine for a team that's always ready.</p>
          </div>
          <div className="sidebar-profile">
            <span className="avatar">IT</span>
            <div>
              <strong>HCVA IT Support</strong>
              <small>Administrator workspace</small>
            </div>
          </div>
          <button
            type="button"
            className="signout"
            onClick={handleLogout}
            disabled={busy}
          >
            <Icon name="logout" />
            {busy ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </aside>
      <div className="workspace-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="menu-toggle secondary"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label="Toggle navigation"
              aria-expanded={menuOpen}
            >
              <Icon name="menu" />
            </button>
            <span>HCVA</span>
            <span className="slash">/</span>
            <strong>{current.label}</strong>
          </div>
          <div className="topbar-right">
            <span className="today">
              {new Intl.DateTimeFormat("en-US", {
                timeZone: "Asia/Manila",
                month: "short",
                day: "numeric",
                year: "numeric",
              }).format(new Date())}{" "}
              · Manila
            </span>
            <span className="session-badge">
              <i /> Admin session
            </span>
          </div>
        </header>
        <main className="content">
          {error && (
            <p className="error message" role="alert">
              {error}
            </p>
          )}
          {activeTab === "dashboard" && <Dashboard onNavigate={navigate} />}
          {activeTab === "people" && <VADirectory />}
          {activeTab === "devices" && (
            <DeviceInventory
              onOpenActionPlan={(id) => {
                setSelectedActionPlan(id);
                setActiveTab("actions");
              }}
            />
          )}
          {activeTab === "schedule" && <QuarterlySchedule />}
          {activeTab === "history" && <InspectionHistory />}
          {activeTab === "incidents" && <IncidentLog />}
          {activeTab === "actions" && (
            <Suspense fallback={<p>Loading action plans…</p>}>
              <ActionPlans
                initialPlanId={selectedActionPlan}
                onNavigate={navigate}
              />
            </Suspense>
          )}
          {activeTab === "emailsettings" && (
            <Suspense fallback={<p>Loading email settings…</p>}>
              <EmailSettings onNavigate={navigate} />
            </Suspense>
          )}
          <footer className="workspace-footer">
            <span>HCVA DeviceCare · Preventive maintenance</span>
            <span>Six-month cadence · Every 6 calendar months</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
