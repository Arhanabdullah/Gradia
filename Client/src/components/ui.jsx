// Shared UI primitives styled after the existing landing-page design system
// (glass panels + CSS variables from index.css). Keep usage light.
// Redesigned under Hallmark: every control ships all eight states, labels are
// sentence-case in the body face, colours ride tokens only.
import { statusChipClass, statusLabel } from "../lib/status";

export const inputClass =
  "w-full rounded-lg border border-(--muted) bg-(--surface-secondary) px-3.5 py-2.5 text-sm text-(--foreground) placeholder:text-(--muted-foreground)/60 outline-none transition-colors focus:border-(--primary) focus-visible:outline-2 focus-visible:outline-(--primary) focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40";

const buttonBase =
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-medium transition-colors active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-(--primary) focus-visible:outline-offset-2";

const variants = {
  primary: `${buttonBase} bg-(--primary) text-(--background) hover:bg-(--primary-hover)`,
  subtle: `${buttonBase} border border-(--border) text-(--foreground) hover:border-(--primary) hover:bg-(--primary)/5`,
  danger: `${buttonBase} border border-(--danger)/40 text-(--danger) hover:bg-(--danger-subtle)`,
  success: `${buttonBase} border border-(--success)/40 text-(--success) hover:bg-(--success-subtle)`,
};

export function Button({ variant = "primary", className = "", ...props }) {
  return <button className={`${variants[variant]} ${className}`} {...props} />;
}

export function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-(--muted)">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

export function Select({ className = "", children, ...props }) {
  return <select className={`${inputClass} ${className}`} {...props}>{children}</select>;
}

export function Card({ className = "", children, ...props }) {
  return (
    <div className={`glass-inner rounded-xl p-5 ${className}`} {...props}>
      {children}
    </div>
  );
}

export function StatCard({ label, value }) {
  return (
    <Card>
      <p className="text-xs font-medium text-(--muted-foreground)">{label}</p>
      <p className="mt-2 text-xl font-semibold tracking-tight text-(--foreground) tabular-nums">{value}</p>
    </Card>
  );
}

export function Empty({ children }) {
  return (
    <p className="rounded-lg border border-dashed border-(--border) px-4 py-5 text-center text-xs text-(--muted-foreground)">
      {children}
    </p>
  );
}

export function StatusChip({ status }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusChipClass[status] ?? statusChipClass.draft}`}
    >
      {statusLabel[status] ?? status}
    </span>
  );
}
