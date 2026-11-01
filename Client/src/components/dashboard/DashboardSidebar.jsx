import { motion } from "framer-motion";
import { microTransition } from "../../animations/variants";
import { NavLink } from "react-router-dom";

// Decorative items for the landing-page ProductPreview mockup (no navigation).
const PREVIEW_ITEMS = [
  { label: "Overview", active: true },
  { label: "Students" },
  { label: "Results" },
  { label: "Subjects" },
  { label: "Reports" },
];

const idleClass =
  "rounded-lg px-4 py-2.5 text-sm font-medium text-(--muted)";
const activeClass =
  "rounded-lg bg-(--sidebar-active) px-4 py-2.5 text-sm font-medium text-(--foreground)";

const SidebarItem = ({ item }) => {
  const hover =
    item.active
      ? undefined
      : {
          x: 2,
          color: "var(--foreground)",
          backgroundColor: "var(--sidebar-hover)",
        };

  if (!item.to) {
    return (
      <motion.div className={item.active ? activeClass : idleClass} whileHover={hover} transition={microTransition}>
        {item.label}
      </motion.div>
    );
  }

  return (
    <NavLink to={item.to} end={item.end}>
      {({ isActive }) => (
        <motion.div
          className={isActive ? activeClass : idleClass}
          whileHover={isActive ? undefined : hover}
          transition={microTransition}
        >
          {item.label}
        </motion.div>
      )}
    </NavLink>
  );
};

const DashboardSidebar = ({ items = PREVIEW_ITEMS, fluid = false }) => {
  return (
    <aside className={`glass-floating flex ${fluid ? "w-full md:w-56" : "w-56"} shrink-0 flex-col p-4`}>
      <div className="mb-8">
        <p className="text-sm font-semibold text-(--foreground)">Gradia</p>
        <p className="mt-0.5 text-[9px] text-(--muted-foreground)">Academic Suite</p>
      </div>
      <nav className="space-y-1">
        {items.map((item) => (
          <SidebarItem key={item.to ?? item.label} item={item} />
        ))}
      </nav>
      <div className="mt-auto border-t border-(--border) pt-4">
        <p className="px-3 text-[9px] uppercase tracking-[0.12em] text-(--muted-foreground)">
          Account
        </p>
        <p className="mt-2 truncate px-3 text-xs text-(--muted)" title="Supabase-authenticated user">
          Secured by Supabase
        </p>
      </div>
    </aside>
  );
};

export default DashboardSidebar;
