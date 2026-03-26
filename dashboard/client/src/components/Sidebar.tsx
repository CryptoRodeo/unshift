import { useState, useEffect, useCallback, useMemo } from "react";
import { NavLink, useLocation, useParams, useNavigate } from "react-router-dom";
import { Tooltip } from "@patternfly/react-core";
import { SunIcon, MoonIcon, BellIcon, BellSlashIcon } from "@patternfly/react-icons";
import type { Run } from "../types";
import { STATUS_COLORS } from "../types";

const DARK_MODE_KEY = "unshift-dark-mode";
const DARK_MODE_CLASS = "pf-v6-theme-dark";

function getInitialDarkMode(): boolean {
  const stored = localStorage.getItem(DARK_MODE_KEY);
  if (stored !== null) return stored === "true";
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export interface SidebarProps {
  connected?: boolean;
  notificationPermission?: NotificationPermission | "default";
  onRequestNotifications?: () => void;
  runs?: Map<string, Run>;
}

export function Sidebar({ connected, notificationPermission, onRequestNotifications, runs }: SidebarProps) {
  const [isDark, setIsDark] = useState(getInitialDarkMode);
  const location = useLocation();
  const navigate = useNavigate();

  // Get current runId from URL if on a detail page
  const currentRunId = location.pathname.startsWith("/runs/")
    ? location.pathname.split("/")[2]
    : null;

  // Recent runs: sorted by startedAt descending, take 12
  const recentRuns = useMemo(() => {
    if (!runs || runs.size === 0) return [];
    return Array.from(runs.values())
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .slice(0, 12);
  }, [runs]);

  // Count of awaiting_approval and active runs
  const { awaitingCount, activeCount } = useMemo(() => {
    if (!runs) return { awaitingCount: 0, activeCount: 0 };
    let awaiting = 0;
    let active = 0;
    for (const run of runs.values()) {
      if (run.status === "awaiting_approval") awaiting++;
      if (["pending", "phase0", "phase1", "phase2", "phase3"].includes(run.status)) active++;
    }
    return { awaitingCount: awaiting, activeCount: active };
  }, [runs]);

  useEffect(() => {
    document.documentElement.classList.toggle(DARK_MODE_CLASS, isDark);
  }, [isDark]);

  const toggleDarkMode = useCallback(() => {
    setIsDark((prev) => {
      const next = !prev;
      localStorage.setItem(DARK_MODE_KEY, String(next));
      return next;
    });
  }, []);

  return (
    <aside className="us-sidebar">
      <div className="us-sidebar__top">
        {/* Brand */}
        <NavLink to="/" className="us-sidebar__brand">
          Unshift
        </NavLink>

        {/* Navigation */}
        <nav className="us-sidebar__nav">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `us-sidebar__nav-item ${isActive && !location.search.includes("status=") ? "us-sidebar__nav-item--active" : ""}`
            }
          >
            <svg className="us-sidebar__nav-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            All Runs
          </NavLink>

          <NavLink
            to="/?status=active"
            className={() =>
              `us-sidebar__nav-item ${location.pathname === "/" && location.search.includes("status=active") ? "us-sidebar__nav-item--active" : ""}`
            }
          >
            <svg className="us-sidebar__nav-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M8 2v2M8 12v2M2 8h2M12 8h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            Active
          </NavLink>

          <NavLink
            to="/?status=awaiting_approval"
            className={() =>
              `us-sidebar__nav-item ${location.pathname === "/" && location.search.includes("status=awaiting_approval") ? "us-sidebar__nav-item--active" : ""}`
            }
          >
            <svg className="us-sidebar__nav-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M8 5v3l2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinnejoin="round"/>
            </svg>
            Awaiting Approval
            {awaitingCount > 0 && (
              <span className="us-sidebar__badge">{awaitingCount}</span>
            )}
          </NavLink>
        </nav>

        {/* Recent runs */}
        {recentRuns.length > 0 && (
          <div className="us-sidebar__section">
            <div className="us-sidebar__section-label">Recent</div>
            <div className="us-sidebar__recent-list">
              {recentRuns.map((run) => (
                <button
                  key={run.id}
                  className={`us-sidebar__recent-item ${run.id === currentRunId ? "us-sidebar__recent-item--active" : ""}`}
                  onClick={() => navigate(`/runs/${run.id}`)}
                >
                  <span
                    className="us-sidebar__status-dot"
                    style={{ backgroundColor: STATUS_COLORS[run.status] || "#8b8b8b" }}
                  />
                  <span className="us-sidebar__recent-key">{run.issueKey}</span>
                  <span className="us-sidebar__recent-time">{relativeTime(run.startedAt)}</span>
                </button>
              ))}
              <NavLink to="/" className="us-sidebar__view-all">
                View all runs
              </NavLink>
            </div>
          </div>
        )}
      </div>

      {/* Bottom section: connection status, summary, notifications, dark mode */}
      <div className="us-sidebar__bottom">
        <div className="us-sidebar__bottom-row">
          {/* Connection status */}
          {connected !== undefined && (
            <Tooltip content={connected ? "WebSocket connected" : "WebSocket disconnected"}>
              <span
                className={`us-sidebar__connection-dot ${connected ? "us-sidebar__connection-dot--connected" : "us-sidebar__connection-dot--disconnected"}`}
                role="status"
                aria-label={connected ? "Connected" : "Disconnected"}
              />
            </Tooltip>
          )}

          {/* Compact run summary */}
          {(activeCount > 0 || awaitingCount > 0) && (
            <span className="us-sidebar__summary">
              {activeCount > 0 && <>{activeCount} active</>}
              {activeCount > 0 && awaitingCount > 0 && " · "}
              {awaitingCount > 0 && <>{awaitingCount} awaiting</>}
            </span>
          )}

          {/* Notification bell */}
          {onRequestNotifications && (
            notificationPermission === "denied" ? (
              <Tooltip content="Notifications blocked. Re-enable in browser settings.">
                <button className="us-sidebar__icon-btn" disabled aria-label="Notifications blocked">
                  <BellSlashIcon />
                </button>
              </Tooltip>
            ) : notificationPermission === "granted" ? (
              <Tooltip content="Notifications enabled">
                <button className="us-sidebar__icon-btn us-sidebar__icon-btn--active" onClick={onRequestNotifications} aria-label="Notifications enabled">
                  <BellIcon />
                </button>
              </Tooltip>
            ) : (
              <Tooltip content="Enable browser notifications">
                <button className="us-sidebar__icon-btn" onClick={onRequestNotifications} aria-label="Enable notifications">
                  <BellIcon />
                </button>
              </Tooltip>
            )
          )}

          {/* Dark mode toggle */}
          <Tooltip content={isDark ? "Switch to light mode" : "Switch to dark mode"}>
            <button
              className="us-sidebar__icon-btn"
              onClick={toggleDarkMode}
              aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            >
              {isDark ? <SunIcon /> : <MoonIcon />}
            </button>
          </Tooltip>
        </div>
      </div>
    </aside>
  );
}
