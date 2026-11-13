import { Outlet, useLocation, Navigate } from "react-router-dom";
import DashboardSidebar from "./DashboardSidebar";
import { useAuth } from "../../context/AuthContext";
import { Button } from "../ui";
import AppLoader from "../AppLoader";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import { useMinLoadingState } from "../../lib/useMinLoadingState";
import { useState, useEffect } from "react";
import BackToTop from "../BackToTop";

const DashboardLayout = () => {
  const { profile, loading, signOut } = useAuth();
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useDocumentTitle("Dashboard");

  // Persist sidebar collapse state
  useEffect(() => {
    const saved = localStorage.getItem("sidebarCollapsed");
    if (saved !== null) setSidebarCollapsed(JSON.parse(saved));
  }, []);

  useEffect(() => {
    localStorage.setItem("sidebarCollapsed", JSON.stringify(sidebarCollapsed));
  }, [sidebarCollapsed]);

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
      <DashboardSidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
      />
      <div className="flex-1">
        <main
          id="main-content"
          tabIndex={-1}
          className="focus-target relative z-10"
        >
          <div className="mx-auto max-w-5xl px-6 py-6">
            <Outlet />
          </div>
        </main>
      </div>
      <BackToTop />
    </div>
  );
};

export default DashboardLayout;