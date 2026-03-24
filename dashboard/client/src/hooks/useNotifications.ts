import { useState, useCallback, useEffect } from "react";

const NOTIFICATION_PERM_KEY = "unshift-notification-prompted";

export function useNotifications() {
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== "undefined" ? Notification.permission : "denied"
  );
  const [prompted, setPrompted] = useState(
    () => localStorage.getItem(NOTIFICATION_PERM_KEY) === "true"
  );

  const requestPermission = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    setPermission(result);
    setPrompted(true);
    localStorage.setItem(NOTIFICATION_PERM_KEY, "true");
  }, []);

  const dismissPrompt = useCallback(() => {
    setPrompted(true);
    localStorage.setItem(NOTIFICATION_PERM_KEY, "true");
  }, []);

  const showBanner = typeof Notification !== "undefined" &&
    permission === "default" &&
    !prompted;

  // Sync permission if user changes it in browser settings
  useEffect(() => {
    if (typeof Notification === "undefined") return;
    const interval = setInterval(() => {
      setPermission(Notification.permission);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  return { permission, showBanner, requestPermission, dismissPrompt };
}

export function sendNotification(title: string, options?: { body?: string; runId?: string }) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const notification = new Notification(title, { body: options?.body });
  if (options?.runId) {
    notification.onclick = () => {
      window.focus();
      window.location.href = `/runs/${options.runId}`;
    };
  }
}
