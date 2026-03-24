import { useState, useCallback, useEffect } from "react";

type NotificationPermission = "default" | "granted" | "denied";

const STORAGE_KEY = "notifications-enabled";

export function useNotifications() {
  const [permission, setPermission] = useState<NotificationPermission>(() => {
    if (typeof Notification === "undefined") return "denied";
    return Notification.permission as NotificationPermission;
  });

  // Sync permission state if it changes externally
  useEffect(() => {
    if (typeof Notification === "undefined") return;
    setPermission(Notification.permission as NotificationPermission);
  }, []);

  const requestPermission = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    setPermission(result as NotificationPermission);
    if (result === "granted") {
      localStorage.setItem(STORAGE_KEY, "true");
    }
  }, []);

  const notify = useCallback(
    (title: string, options?: { body?: string; onClick?: () => void }) => {
      if (typeof Notification === "undefined") return;
      if (Notification.permission !== "granted") return;
      if (!document.hidden) return;

      const notification = new Notification(title, { body: options?.body });
      if (options?.onClick) {
        notification.onclick = () => {
          window.focus();
          options.onClick!();
          notification.close();
        };
      }
    },
    []
  );

  const enabled = permission === "granted" && localStorage.getItem(STORAGE_KEY) === "true";

  return { permission, requestPermission, notify, enabled };
}
