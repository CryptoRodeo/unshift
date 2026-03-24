import { useState, useCallback, useEffect, useRef } from "react";

type NotificationPermission = "default" | "granted" | "denied";

const STORAGE_KEY = "notifications-enabled";

export interface ToastEntry {
  id: number;
  title: string;
  body?: string;
  variant: "info" | "warning" | "success";
  onClick?: () => void;
}

let nextToastId = 1;

export function useNotifications() {
  const [permission, setPermission] = useState<NotificationPermission>(() => {
    if (typeof Notification === "undefined") return "denied";
    return Notification.permission as NotificationPermission;
  });
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const titleFlashRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const originalTitleRef = useRef(document.title);

  // Sync permission state if it changes externally
  useEffect(() => {
    if (typeof Notification === "undefined") return;
    setPermission(Notification.permission as NotificationPermission);
  }, []);

  // Stop title flash when tab becomes visible
  useEffect(() => {
    const handleVisibility = () => {
      if (!document.hidden && titleFlashRef.current) {
        clearInterval(titleFlashRef.current);
        titleFlashRef.current = null;
        document.title = originalTitleRef.current;
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  const requestPermission = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    setPermission(result as NotificationPermission);
    if (result === "granted") {
      localStorage.setItem(STORAGE_KEY, "true");
    }
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback(
    (title: string, options?: { body?: string; onClick?: () => void; force?: boolean }) => {
      const force = options?.force ?? false;

      // In-app toast for when tab is focused (or always if force)
      if (force && !document.hidden) {
        const id = nextToastId++;
        const toast: ToastEntry = {
          id,
          title,
          body: options?.body,
          variant: "info",
          onClick: options?.onClick,
        };
        setToasts((prev) => [...prev, toast]);
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, 8000);
      }

      // Browser notification (always fire when hidden, or when force even if visible)
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        if (document.hidden || force) {
          const notification = new Notification(title, { body: options?.body });
          if (options?.onClick) {
            notification.onclick = () => {
              window.focus();
              options.onClick!();
              notification.close();
            };
          }
        }
      }

      // Flash document title when tab is hidden
      if (document.hidden && !titleFlashRef.current) {
        originalTitleRef.current = document.title;
        let toggle = false;
        titleFlashRef.current = setInterval(() => {
          document.title = toggle ? originalTitleRef.current : `⚠ ${title}`;
          toggle = !toggle;
        }, 1000);
      }
    },
    []
  );

  const enabled = permission === "granted" && localStorage.getItem(STORAGE_KEY) === "true";

  return { permission, requestPermission, notify, enabled, toasts, dismissToast };
}
