// Branded full-screen loading state: glass card, cyan spinner ring.
// role="status" + aria-busy announces the wait to screen readers; the
// global prefers-reduced-motion rule stops the spin for those users.

const AppLoader = ({ label = "Loading Gradia" }) => {
  return (
    <div className="grid-background flex min-h-screen items-center justify-center bg-(--background) p-6">
      <div
        className="glass-panel flex flex-col items-center gap-6 rounded-2xl px-10 py-10"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <div className="relative flex h-16 w-16 items-center justify-center" aria-hidden="true">
          <span className="loader-ring absolute inset-0" />
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

        <p className="text-sm font-medium text-(--muted-foreground)">{label}</p>

        <div className="flex gap-1.5" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-(--primary) animate-pulse"
              style={{ animationDelay: `${0.5 + i * 0.15}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default AppLoader;