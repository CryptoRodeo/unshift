import { useState, useEffect } from "react";

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function ElapsedTime({
  startedAt,
  completedAt,
}: {
  startedAt: string;
  completedAt?: string;
}) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (completedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [completedAt]);

  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : now;
  const elapsed = Math.max(0, end - start);

  return <span>{formatDuration(elapsed)}</span>;
}
