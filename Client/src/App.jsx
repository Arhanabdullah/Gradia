import { Routes, Route } from "react-router-dom";
import { Suspense, lazy } from "react";

import Landing from "./pages/Landing";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";
import RequestDemo from "./pages/RequestDemo";
import DashboardLayout from "./components/dashboard/DashboardLayout";
import AppLoader from "./components/AppLoader";
import { useAuth } from "./context/AuthContext";
import { Navigate } from "react-router-dom";
import RouteMetaUpdater from "./components/RouteMetaUpdater";
import { useMinLoadingState } from "./lib/useMinLoadingState";

// Lazy load heavy pages that use recharts
const Overview = lazy(() => import("./pages/Overview"));
const MarksEntry = lazy(() => import("./pages/teacher/MarksEntry"));
const MyResults = lazy(() => import("./pages/student/MyResults"));
const PublishSheets = lazy(() => import("./pages/principal/PublishSheets"));

// Lazy load admin pages
const ManageUsers = lazy(() => import("./pages/admin/ManageUsers"));
const ManageClasses = lazy(() => import("./pages/admin/ManageClasses"));
const ManageExams = lazy(() => import("./pages/admin/ManageExams"));
const AdminSheets = lazy(() => import("./pages/admin/AdminSheets"));

// Lazy load other role pages
const ReviewSheets = lazy(() => import("./pages/hod/ReviewSheets"));
const Notifications = lazy(() => import("./pages/student/Notifications"));

const RequireRole = ({ role, roles, children }) => {
  const { profile, loading } = useAuth();
  const showLoader = useMinLoadingState(loading, 700);
  if (showLoader) return <AppLoader />;
  if (!profile) return null;
  const allowed = roles ?? (role ? [role] : []);
  if (allowed.length && !allowed.includes(profile.role)) return <Navigate to="/app" replace />;
  return children;
};

const App = () => {
  return (
    <>
      <RouteMetaUpdater />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/request-demo" element={<RequestDemo />} />
        <Route path="/app" element={<DashboardLayout />}>
          <Route
            index
            element={
              <Suspense fallback={<AppLoader label="Loading overview…" />}>
                <Overview />
              </Suspense>
            }
          />
          <Route
            path="users"
            element={
              <RequireRole role="admin">
                <Suspense fallback={<AppLoader label="Loading users…" />}>
                  <ManageUsers />
                </Suspense>
              </RequireRole>
            }
          />
          <Route
            path="classes"
            element={
              <RequireRole role="admin">
                <Suspense fallback={<AppLoader label="Loading classes…" />}>
                  <ManageClasses />
                </Suspense>
              </RequireRole>
            }
          />
          <Route
            path="exams"
            element={
              <RequireRole roles={["admin", "teacher", "hod"]}>
                <Suspense fallback={<AppLoader label="Loading exams…" />}>
                  <ManageExams />
                </Suspense>
              </RequireRole>
            }
          />
          <Route
            path="sheets"
            element={
              <RequireRole role="admin">
                <Suspense fallback={<AppLoader label="Loading sheets…" />}>
                  <AdminSheets />
                </Suspense>
              </RequireRole>
            }
          />
          <Route
            path="marks"
            element={
              <RequireRole role="teacher">
                <Suspense fallback={<AppLoader label="Loading marks entry…" />}>
                  <MarksEntry />
                </Suspense>
              </RequireRole>
            }
          />
          <Route
            path="review"
            element={
              <RequireRole role="hod">
                <Suspense fallback={<AppLoader label="Loading review…" />}>
                  <ReviewSheets />
                </Suspense>
              </RequireRole>
            }
          />
          <Route
            path="publish"
            element={
              <RequireRole role="principal">
                <Suspense fallback={<AppLoader label="Loading publishing…" />}>
                  <PublishSheets />
                </Suspense>
              </RequireRole>
            }
          />
          <Route
            path="results"
            element={
              <RequireRole role="student">
                <Suspense fallback={<AppLoader label="Loading results…" />}>
                  <MyResults />
                </Suspense>
              </RequireRole>
            }
          />
          <Route
            path="notifications"
            element={
              <RequireRole role="student">
                <Suspense fallback={<AppLoader label="Loading notifications…" />}>
                  <Notifications />
                </Suspense>
              </RequireRole>
            }
          />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
};

export default App;
