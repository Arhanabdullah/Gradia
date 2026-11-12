// Branded full-screen loading state: glass card, cyan spinner ring.
// role="status" + aria-busy announces the wait to screen readers; the
// global prefers-reduced-motion rule stops the spin for those users.
const AppLoader = ({ label = "Loading Gradia" }) => (
  <div className="grid-background flex min-h-screen items-center justify-center bg-(--background) p-6">
    <div
      className="glass-panel flex flex-col items-center gap-5 rounded-2xl px-10 py-9"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="loader-ring" aria-hidden="true" />
      <p className="text-sm font-medium text-(--muted-foreground)">{label}</p>
    </div>
  </div>
);

export default AppLoader;
