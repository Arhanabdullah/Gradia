import { Outlet, useLocation, Navigate } from "react-router-dom";
import DashboardSidebar from "./DashboardSidebar";
import { useAuth } from "../../context/AuthContext";
import { Button } from "../ui";
import AppLoader from "../AppLoader";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import { useMinLoadingState } from "../../lib/useMinLoadingState";

const NAV_BY_ROLE = {
  admin: [
    { to: "/app", label: "Overview", end: true },
    { to: "/app/users", label: "Users" },
    { to: "/app/classes", label: "Academics" },
    { to: "/app/exams", label: "Exams" },
    { to: "/app/sheets", label: "Result Sheets" },
  ],
  teacher: [
    { to: "/app", label: "Overview", end: true },
    { to: "/app/exams", label: "Exams" },
    { to: "/app/marks", label: "Marks Entry" },
  ],
  hod: [
    { to: "/app", label: "Overview", end: true },
    { to: "/app/exams", label: "Exams" },
    { to: "/app/review", label: "Review Sheets" },
  ],
  principal: [
    { to: "/app", label: "Overview", end: true },
    { to: "/app/publish", label: "Sign Off & Publish" },
  ],
  student: [
    { to: "/app", label: "Overview", end: true },
    { to: "/app/results", label: "My Results" },
    { to: "/app/notifications", label: "Notifications" },
  ],
};

const DashboardLayout = () => {
  const { profile, loading, signOut } = useAuth();
  const location = useLocation();

  useDocumentTitle("Dashboard");

  // hold the loader on screen briefly even on fast profile fetches
  const showLoader = useMinLoadingState(loading, 700);
  if (showLoader) return <AppLoader />;

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
      <a
        href="#main-content"
        className="sr-only rounded-xl bg-(--primary) px-4 py-2.5 text-sm font-semibold text-(--background) focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50"
      >
        Skip to content
      </a>
      <DashboardSidebar items={NAV_BY_ROLE[profile.role] ?? []} />
      <main
        id="main-content"
        tabIndex={-1}
        className="focus-target relative z-10 flex-1 overflow-y-auto p-6"
      >
        <div className="mx-auto max-w-5xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default DashboardLayout;
