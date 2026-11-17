// Hallmark · Loading screen — branded, accessible, reduced-motion aware.
// Shows immediately via inline CSS in index.html, then this component
// takes over once React hydrates for subsequent loads.

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

const AppLoader = ({ label = "Loading Gradia" }) => {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const handler = (e) => setReducedMotion(e.matches);
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, []);

  return (
    <div
      className="grid-background flex min-h-screen items-center justify-center bg-(--background) p-6"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={label}
    >
      <div className="glass-panel flex flex-col items-center gap-6 rounded-2xl px-10 py-10 max-w-xs w-full">
        {/* Document icon with spinner ring — the signature visual */}
        <div className="relative flex h-16 w-16 items-center justify-center" aria-hidden="true">
          <motion.span
            className="loader-ring absolute inset-0"
            animate={reducedMotion ? {} : { rotate: 360 }}
            transition={{ duration: 1, ease: "linear", repeat: Infinity }}
            style={{ animationPlayState: reducedMotion ? "paused" : "running" }}
          />
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="absolute h-10 w-10 text-(--primary)"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <path d="M10 13 12 15 16 11" strokeWidth={2} stroke="var(--primary)" />
          </svg>
        </div>

        <p className="text-sm font-medium text-(--muted-foreground) text-center">{label}</p>

        {/* Progress dots — subtle, not the main show */}
        <div className="flex gap-1.5" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-(--primary)"
              initial={reducedMotion ? {} : { scale: 0.5, opacity: 0.4 }}
              animate={reducedMotion ? {} : { scale: [0.5, 1, 0.5], opacity: [0.4, 1, 0.4] }}
              transition={{
                delay: 0.15 + i * 0.12,
                duration: 0.5,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default AppLoader;