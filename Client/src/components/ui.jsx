// Shared UI primitives styled after the existing landing-page design system
// (glass panels + CSS variables from index.css). Keep usage light.
import { statusChipClass, statusLabel } from "../lib/status";

export const inputClass =
  "w-full rounded-lg border border-(--border) bg-(--surface) px-3 py-2 text-sm text-(--foreground) placeholder:text-(--muted-foreground)/60 outline-none transition-colors focus:border-(--primary)";

const buttonBase =
  "rounded-lg px-3.5 py-2 text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-40";

const variants = {
  primary: `${buttonBase} bg-(--primary-deep) text-white hover:bg-(--primary-deep)/85`,
  subtle: `${buttonBase} border border-(--border) text-(--foreground) hover:border-(--primary)`,
  danger: `${buttonBase} border border-red-500/40 text-red-500 hover:bg-red-500/10`,
  success: `${buttonBase} border border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/10`,
};

export function Button({ variant = "primary", className = "", ...props }) {
  return <button className={`${variants[variant]} ${className}`} {...props} />;
}

export function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-(--muted-foreground)">
        {label}
      </span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

export function Select({ className = "", children, ...props }) {
  return (
    <select className={`${inputClass} ${className}`} {...props}>
      {children}
    </select>
  );
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
      <p className="text-[10px] font-medium text-(--tertiary)/80">{label}</p>
      <p className="mt-2 text-xl font-semibold tracking-tight text-(--foreground)">{value}</p>
    </Card>
  );
}

export function Empty({ children }) {
  return (
    <p className="rounded-lg border border-dashed border-(--border) px-4 py-6 text-center text-xs text-(--muted-foreground)">
      {children}
    </p>
  );
}

export function StatusChip({ status }) {
  return (
    <span
      className={`inline-block rounded-full border px-2.5 py-1 text-[9px] font-medium ${statusChipClass[status] ?? statusChipClass.draft}`}
    >
      {statusLabel[status] ?? status}
    </span>
  );
}
