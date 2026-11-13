import { Outlet, useLocation, Navigate } from "react-router-dom";
import DashboardSidebar from "./DashboardSidebar";
import { useAuth } from "../../context/AuthContext";
import { Button } from "../ui";

const NAV_BY_ROLE = {
  admin: [
    { to: "/app", label: "Overview", end: true },
    { to: "/app/directory", label: "Users Dashboard" },
    { to: "/app/users", label: "Users" },
    { to: "/app/classes", label: "Academics" },
    { to: "/app/exams", label: "Exams" },
    { to: "/app/attendance", label: "Attendance" },
    { to: "/app/sheets", label: "Result Sheets" },
  ],
  teacher: [
    { to: "/app", label: "Overview", end: true },
    { to: "/app/directory", label: "Users Dashboard" },
    { to: "/app/exams", label: "Exams" },
    { to: "/app/marks", label: "Marks Entry" },
    { to: "/app/attendance", label: "Attendance" },
  ],
  hod: [
    { to: "/app", label: "Overview", end: true },
    { to: "/app/directory", label: "Users Dashboard" },
    { to: "/app/exams", label: "Exams" },
    { to: "/app/attendance", label: "Attendance" },
    { to: "/app/review", label: "Review Sheets" },
  ],
  principal: [
    { to: "/app", label: "Overview", end: true },
    { to: "/app/directory", label: "Users Dashboard" },
    { to: "/app/publish", label: "Publish results" },
  ],
  student: [
    { to: "/app", label: "Overview", end: true },
    { to: "/app/results", label: "My Results" },
    { to: "/app/notifications", label: "Notifications" },
  ],
  coordinator: [
    { to: "/app", label: "Overview", end: true },
    { to: "/app/reports", label: "Monitoring" },
    { to: "/app/archive", label: "Result archive" },
    { to: "/app/directory", label: "Users Dashboard" },
  ],
  exam_cell: [
    { to: "/app", label: "Overview", end: true },
    { to: "/app/config", label: "Result configuration" },
    { to: "/app/assessment", label: "Assessment setup" },
    { to: "/app/approval", label: "Result approval" },
    { to: "/app/sheets", label: "Result Sheets" },
    { to: "/app/archive", label: "Result archive" },
    { to: "/app/directory", label: "Users Dashboard" },
  ],
};

const DashboardLayout = () => {
  const { profile, loading, signOut } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="grid-background flex min-h-screen items-center justify-center bg-(--background)">
        <p className="text-sm text-(--muted-foreground)">Loading Gradia…</p>
      </div>
    );
  }

  if (!profile) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  if (profile.is_active === false) {
    return (
      <div className="grid-background flex min-h-screen items-center justify-center bg-(--background) p-6 text-(--foreground)">
        <div className="glass-panel max-w-sm rounded-2xl p-8 text-center">
          <p className="text-sm font-semibold">Account deactivated</p>
          <p className="mt-2 text-xs text-(--muted-foreground)">
            Your account has been deactivated by an administrator. Contact your institution's admin.
          </p>
          <Button variant="subtle" className="mt-5" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid-background flex min-h-screen bg-(--background) text-(--foreground)">
      <DashboardSidebar items={NAV_BY_ROLE[profile.role] ?? []} />
      <main className="relative z-10 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-5xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default DashboardLayout;
