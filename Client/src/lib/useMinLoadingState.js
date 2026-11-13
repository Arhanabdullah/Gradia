// Holds a loading flag on screen for at least `minMs`, so fast fetches
// don't strobe the loader for a single frame.
import { useEffect, useRef, useState } from "react";

export function useMinLoadingState(loading, minMs = 700) {
  // start tracks when the current loading period began
  const startRef = useRef(Date.now());
  const [held, setHeld] = useState(loading);

  useEffect(() => {
    if (loading) {
      startRef.current = Date.now();
      setHeld(true);
      return;
    }
    const remaining = minMs - (Date.now() - startRef.current);
    if (remaining <= 0) {
      setHeld(false);
      return;
    }
    const t = setTimeout(() => setHeld(false), remaining);
    return () => clearTimeout(t);
  }, [loading, minMs]);

  return loading || held;
}
