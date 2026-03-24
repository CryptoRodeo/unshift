import { useState, useEffect, useCallback } from "react";
import { useLocation, Link } from "react-router-dom";
import { Tooltip } from "@patternfly/react-core";
import { SunIcon, MoonIcon, BellIcon, BellSlashIcon } from "@patternfly/react-icons";

const DARK_MODE_KEY = "unshift-dark-mode";
const DARK_MODE_CLASS = "pf-v6-theme-dark";

function getInitialDarkMode(): boolean {
  const stored = localStorage.getItem(DARK_MODE_KEY);
  if (stored !== null) return stored === "true";
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export interface AppHeaderProps {
  connected?: boolean;
  notificationPermission?: NotificationPermission | "default";
  onRequestNotifications?: () => void;
  breadcrumbLabel?: string | null;
}

export function AppHeader({ connected, notificationPermission, onRequestNotifications, breadcrumbLabel }: AppHeaderProps) {
  const [isDark, setIsDark] = useState(getInitialDarkMode);
  const location = useLocation();

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

  // Build breadcrumb from current route
  const breadcrumbs = buildBreadcrumbs(location.pathname, breadcrumbLabel ?? undefined);

  return (
    <header className="us-header">
      <div className="us-header__left">
        <Link to="/" className="us-header__brand">Unshift</Link>
        {breadcrumbs.length > 0 && (
          <nav className="us-header__breadcrumbs" aria-label="Breadcrumb">
            {breadcrumbs.map((crumb, i) => (
              <span key={i} className="us-header__breadcrumb-item">
                <span className="us-header__breadcrumb-sep">/</span>
                {crumb.href ? (
                  <Link to={crumb.href} className="us-header__breadcrumb-link">{crumb.label}</Link>
                ) : (
                  <Tooltip content={crumb.label}>
                    <span className="us-header__breadcrumb-current">{crumb.label}</span>
                  </Tooltip>
                )}
              </span>
            ))}
          </nav>
        )}
      </div>

      <div className="us-header__right">
        {/* Connection status dot */}
        {connected !== undefined && (
          <Tooltip content={connected ? "WebSocket connected" : "WebSocket disconnected"}>
            <span
              className={`us-header__connection-dot ${connected ? "us-header__connection-dot--connected" : "us-header__connection-dot--disconnected"}`}
              role="status"
              aria-label={connected ? "Connected" : "Disconnected"}
            />
          </Tooltip>
        )}

        {/* Notification bell */}
        {onRequestNotifications && (
          notificationPermission === "denied" ? (
            <Tooltip content="Notifications blocked. Re-enable in browser settings.">
              <button className="us-header__icon-btn" disabled aria-label="Notifications blocked">
                <BellSlashIcon />
              </button>
            </Tooltip>
          ) : notificationPermission === "granted" ? (
            <Tooltip content="Notifications enabled">
              <button className="us-header__icon-btn us-header__icon-btn--active" onClick={onRequestNotifications} aria-label="Notifications enabled">
                <BellIcon />
              </button>
            </Tooltip>
          ) : (
            <Tooltip content="Enable browser notifications">
              <button className="us-header__icon-btn" onClick={onRequestNotifications} aria-label="Enable notifications">
                <BellIcon />
              </button>
            </Tooltip>
          )
        )}

        {/* Dark mode toggle */}
        <Tooltip content={isDark ? "Switch to light mode" : "Switch to dark mode"}>
          <button
            className="us-header__icon-btn"
            onClick={toggleDarkMode}
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
          >
            {isDark ? <SunIcon /> : <MoonIcon />}
          </button>
        </Tooltip>
      </div>
    </header>
  );
}

interface Breadcrumb {
  label: string;
  href?: string;
}

function buildBreadcrumbs(pathname: string, breadcrumbLabel?: string): Breadcrumb[] {
  // /runs/:runId → ["Runs", "PROJ-123"]
  const match = pathname.match(/^\/runs\/(.+)$/);
  if (match) {
    return [
      { label: "Runs", href: "/" },
      { label: breadcrumbLabel || match[1] },
    ];
  }
  // / → just "Runs" (shown as current)
  if (pathname === "/") {
    return [{ label: "Runs" }];
  }
  return [];
}
