import { useState, useEffect } from "react";
import { formatDuration } from "../types";

export function useElapsedTime(startedAt: string, completedAt?: string): string {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (completedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [completedAt]);

  const end = completedAt ? Date.parse(completedAt) : now;
  const elapsed = Math.max(0, end - Date.parse(startedAt));
  return formatDuration(elapsed);
}
