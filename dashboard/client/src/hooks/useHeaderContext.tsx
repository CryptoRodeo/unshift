import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface HeaderState {
  connected: boolean;
  notificationPermission: NotificationPermission | "default";
  onRequestNotifications: (() => void) | null;
  breadcrumbLabel: string | null;
}

interface HeaderContextValue extends HeaderState {
  setConnected: (v: boolean) => void;
  setNotificationPermission: (v: NotificationPermission | "default") => void;
  setOnRequestNotifications: (fn: (() => void) | null) => void;
  setBreadcrumbLabel: (label: string | null) => void;
}

const HeaderContext = createContext<HeaderContextValue | null>(null);

export function HeaderProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "default">("default");
  const [onRequestNotifications, setOnRequestNotifications] = useState<(() => void) | null>(null);
  const [breadcrumbLabel, setBreadcrumbLabel] = useState<string | null>(null);

  const value: HeaderContextValue = {
    connected,
    notificationPermission,
    onRequestNotifications,
    breadcrumbLabel,
    setConnected,
    setNotificationPermission,
    setOnRequestNotifications: useCallback((fn: (() => void) | null) => {
      setOnRequestNotifications(() => fn);
    }, []),
    setBreadcrumbLabel,
  };

  return <HeaderContext.Provider value={value}>{children}</HeaderContext.Provider>;
}

export function useHeaderContext() {
  return useContext(HeaderContext);
}
