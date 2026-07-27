import { useEffect, useRef } from "react";

const REVISION_KEY = "anina_schedule_revision";

export function useScheduleRefresh(refresh, { intervalMs = 30000 } = {}) {
  const refreshRef = useRef(refresh);
  const timerRef = useRef(null);
  refreshRef.current = refresh;

  useEffect(() => {
    const run = () => {
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        Promise.resolve(refreshRef.current()).catch(() => {});
      }, 120);
    };
    const onStorage = (event) => {
      if (event.key === REVISION_KEY) run();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") run();
    };

    window.addEventListener("anina:schedule-changed", run);
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", onVisibility);
    const interval = window.setInterval(run, intervalMs);

    return () => {
      window.clearTimeout(timerRef.current);
      window.clearInterval(interval);
      window.removeEventListener("anina:schedule-changed", run);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs]);
}
