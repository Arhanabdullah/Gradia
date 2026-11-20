import { NavLink } from "react-router-dom";
import { motion } from "framer-motion";
import { LayoutDashboard, Users, GraduationCap, FileText, BarChart2, CheckCircle2, Send, Award, Bell, LogOut, Menu, X, ChevronLeft, CalendarCheck, Archive, SlidersHorizontal, ClipboardList, BookOpen } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { microTransition } from "../../animations/variants";

// Role-based navigation config
const NAV_BY_ROLE = {
  admin: [
    { to: "/app", label: "Overview", icon: LayoutDashboard, end: true },
    { to: "/app/directory", label: "Users Dashboard", icon: Users },
    { to: "/app/users", label: "Users", icon: Users },
    { to: "/app/classes", label: "Academics", icon: GraduationCap },
    { to: "/app/exams", label: "Semester Examination", icon: FileText },
    { to: "/app/classwork", label: "Classwork", icon: BookOpen },
    { to: "/app/attendance", label: "Attendance", icon: CalendarCheck },
    { to: "/app/sheets", label: "Result Sheets", icon: BarChart2 },
  ],
  teacher: [
    { to: "/app", label: "Overview", icon: LayoutDashboard, end: true },
    { to: "/app/directory", label: "Users Dashboard", icon: Users },
    { to: "/app/exams", label: "Semester Examination", icon: FileText },
    { to: "/app/classwork", label: "Classwork", icon: BookOpen },
    { to: "/app/marks", label: "Marks Entry", icon: CheckCircle2 },
    { to: "/app/attendance", label: "Attendance", icon: CalendarCheck },
  ],
  hod: [
    { to: "/app", label: "Overview", icon: LayoutDashboard, end: true },
    { to: "/app/directory", label: "Users Dashboard", icon: Users },
    { to: "/app/exams", label: "Semester Examination", icon: FileText },
    { to: "/app/attendance", label: "Attendance", icon: CalendarCheck },
    { to: "/app/review", label: "Review Sheets", icon: Send },
  ],
  principal: [
    { to: "/app", label: "Overview", icon: LayoutDashboard, end: true },
    { to: "/app/directory", label: "Users Dashboard", icon: Users },
    { to: "/app/publish", label: "Sign Off & Publish", icon: Award },
  ],
  student: [
    { to: "/app", label: "Overview", icon: LayoutDashboard, end: true },
    { to: "/app/classwork", label: "Classwork", icon: BookOpen },
    { to: "/app/results", label: "My Results", icon: Award },
    { to: "/app/notifications", label: "Notifications", icon: Bell },
  ],
  coordinator: [
    { to: "/app", label: "Overview", icon: LayoutDashboard, end: true },
    { to: "/app/reports", label: "Monitoring", icon: BarChart2 },
    { to: "/app/archive", label: "Result archive", icon: Archive },
    { to: "/app/directory", label: "Users Dashboard", icon: Users },
  ],
  exam_cell: [
    { to: "/app", label: "Overview", icon: LayoutDashboard, end: true },
    { to: "/app/exams", label: "Semester Examination", icon: FileText },
    { to: "/app/config", label: "Result configuration", icon: SlidersHorizontal },
    { to: "/app/assessment", label: "Assessment setup", icon: ClipboardList },
    { to: "/app/classwork", label: "Classwork", icon: BookOpen },
    { to: "/app/approval", label: "Result approval", icon: CheckCircle2 },
    { to: "/app/sheets", label: "Result Sheets", icon: BarChart2 },
    { to: "/app/archive", label: "Result archive", icon: Archive },
    { to: "/app/directory", label: "Users Dashboard", icon: Users },
  ],
};

// Preview items for landing page ProductPreview
const PREVIEW_ITEMS = [
  { label: "Overview", icon: LayoutDashboard, active: true },
  { label: "Students", icon: Users },
  { label: "Results", icon: Award },
  { label: "Subjects", icon: GraduationCap },
  { label: "Reports", icon: BarChart2 },
];

const SidebarItem = ({ item, isActive, collapsed = false }) => {
  const Icon = item.icon;
  const baseClass = `flex items-center gap-3 w-full rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${collapsed ? "justify-center" : ""}`;
  const activeClass = `${baseClass} bg-(--sidebar-active) text-(--foreground)`;
  const idleClass = `${baseClass} text-(--muted) hover:bg-(--sidebar-hover) hover:text-(--foreground) focus-visible:outline-2 focus-visible:outline-(--primary)`;

  if (!item.to) {
    return (
      <motion.div
        className={isActive ? activeClass : idleClass}
        whileHover={isActive ? undefined : { x: 2 }}
        transition={microTransition}
        title={collapsed ? item.label : undefined}
      >
        <Icon className="h-4 w-4 flex-shrink-0" strokeWidth={2} aria-hidden="true" />
        {collapsed ? null : item.label}
      </motion.div>
    );
  }

  return (
    <NavLink
      to={item.to}
      end={item.end}
      aria-label={collapsed ? item.label : undefined}
      title={collapsed ? item.label : undefined}
    >
      {({ isActive: active }) => (
        <motion.div
          className={active ? activeClass : idleClass}
          whileHover={active ? undefined : { x: 2 }}
          transition={microTransition}
        >
          <Icon className="h-4 w-4 flex-shrink-0" strokeWidth={2} aria-hidden="true" />
          {collapsed ? null : item.label}
        </motion.div>
      )}
    </NavLink>
  );
};

export default function DashboardSidebar({
  items,
  fluid = false,
  onToggleCollapse,
  collapsed = false
}) {
  const { profile, signOut } = useAuth();
  const navItems = items?.length ? items : (profile ? NAV_BY_ROLE[profile.role] ?? [] : PREVIEW_ITEMS);
  const isPreview = !profile;

  return (
    <aside
      className={`glass-floating flex shrink-0 flex-col transition-[width] duration-300 ease-out ${
        fluid ? "w-full md:w-64" : collapsed ? "w-16" : "w-64"
      }`}
      aria-label="Main navigation"
    >
      {/* Brand header */}
      <div
        className={`flex items-center gap-3 border-b border-(--border) p-4 ${
          collapsed && !fluid ? "justify-center" : ""
        }`}
      >
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-(--foreground) truncate">Gradia</p>
            <p className="mt-0.5 text-xs text-(--muted) truncate">Academic suite</p>
          </div>
        )}
        {!fluid && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-(--muted) hover:text-(--foreground) hover:bg-(--surface-secondary) transition-colors ${collapsed ? "rotate-180" : ""}`}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={2} />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-3 overflow-y-auto" aria-label={isPreview ? "Preview sections" : "Dashboard"}>
        {navItems.map((item) => (
          <SidebarItem
            key={item.to ?? item.label}
            item={item}
            isActive={item.active}
            collapsed={collapsed && !fluid}
          />
        ))}
      </nav>

      {/* Account section - only for authenticated users */}
      {!isPreview && (
        <div className={`border-t border-(--border) p-4 transition-opacity duration-200 ${collapsed && !fluid ? "opacity-0 pointer-events-none" : ""}`}>
          <div className="flex items-center gap-3">
            <div className={`flex-1 min-w-0 ${collapsed ? "hidden" : "block"}`}>
              <p className="text-xs font-medium text-(--foreground) truncate">
                {profile?.username ?? profile?.email?.split("@")[0] ?? "User"}
              </p>
              <p className="text-[11px] text-(--muted) truncate capitalize">
                {profile?.role ?? "guest"}
              </p>
            </div>
            {!collapsed && (
              <button
                onClick={signOut}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-(--muted) hover:text-(--danger) hover:bg-(--danger-subtle) transition-colors"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" strokeWidth={2} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Preview footer */}
      {isPreview && (
        <div className="mt-auto border-t border-(--border) pt-4">
          <p className="px-3 text-xs text-(--muted)">
            This is a preview. Sign in to access the full dashboard.
          </p>
        </div>
      )}
    </aside>
  );
}