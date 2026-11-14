import { lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";

import Landing from "./pages/Landing";
import Login from "./pages/Login";
import DashboardLayout from "./components/dashboard/DashboardLayout";
import { useAuth } from "./context/AuthContext";

// Dashboard screens are code-split so the shell paints before every page (and
// its charts) is downloaded. Each screen fetches its own chunk on demand.
const Overview = lazy(() => import("./pages/Overview"));
const UsersDirectory = lazy(() => import("./pages/UsersDirectory"));
const ManageUsers = lazy(() => import("./pages/admin/ManageUsers"));
const ManageClasses = lazy(() => import("./pages/admin/ManageClasses"));
const ManageExams = lazy(() => import("./pages/admin/ManageExams"));
const AdminSheets = lazy(() => import("./pages/admin/AdminSheets"));
const MarksEntry = lazy(() => import("./pages/teacher/MarksEntry"));
const Attendance = lazy(() => import("./pages/teacher/Attendance"));
const ReviewSheets = lazy(() => import("./pages/hod/ReviewSheets"));
const PublishSheets = lazy(() => import("./pages/principal/PublishSheets"));
const MyResults = lazy(() => import("./pages/student/MyResults"));
const Notifications = lazy(() => import("./pages/student/Notifications"));
const CoordinatorReports = lazy(() => import("./pages/coordinator/CoordinatorReports"));
const ResultArchive = lazy(() => import("./pages/coordinator/ResultArchive"));
const ResultConfig = lazy(() => import("./pages/exam_cell/ResultConfig"));
const AssessmentSetup = lazy(() => import("./pages/exam_cell/AssessmentSetup"));
const ResultApproval = lazy(() => import("./pages/exam_cell/ResultApproval"));

const RequireRole = ({ role, roles, children }) => {
  const { profile } = useAuth();
  if (!profile) return null;
  const allowed = roles ?? (role ? [role] : []);
  if (allowed.length && !allowed.includes(profile.role)) return <Navigate to="/app" replace />;
  return children;
};

const App = () => {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/app" element={<DashboardLayout />}>
        <Route index element={<Overview />} />
        <Route
          path="directory"
          element={
            <RequireRole roles={["admin", "principal", "hod", "teacher", "coordinator", "exam_cell"]}>
              <UsersDirectory />
            </RequireRole>
          }
        />
        <Route
          path="users"
          element={
            <RequireRole role="admin">
              <ManageUsers />
            </RequireRole>
          }
        />
        <Route
          path="classes"
          element={
            <RequireRole role="admin">
              <ManageClasses />
            </RequireRole>
          }
        />
        <Route
          path="exams"
          element={
            <RequireRole roles={["admin", "teacher", "hod"]}>
              <ManageExams />
            </RequireRole>
          }
        />
        <Route
          path="sheets"
          element={
            <RequireRole roles={["admin", "exam_cell"]}>
              <AdminSheets />
            </RequireRole>
          }
        />
        <Route
          path="marks"
          element={
            <RequireRole role="teacher">
              <MarksEntry />
            </RequireRole>
          }
        />
        <Route
          path="attendance"
          element={
            <RequireRole roles={["admin", "teacher", "hod"]}>
              <Attendance />
            </RequireRole>
          }
        />
        <Route
          path="review"
          element={
            <RequireRole role="hod">
              <ReviewSheets />
            </RequireRole>
          }
        />
        <Route
          path="publish"
          element={
            <RequireRole role="principal">
              <PublishSheets />
            </RequireRole>
          }
        />
        <Route
          path="results"
          element={
            <RequireRole role="student">
              <MyResults />
            </RequireRole>
          }
        />
        <Route
          path="notifications"
          element={
            <RequireRole role="student">
              <Notifications />
            </RequireRole>
          }
        />
        <Route
          path="reports"
          element={
            <RequireRole role="coordinator">
              <CoordinatorReports />
            </RequireRole>
          }
        />
        <Route
          path="archive"
          element={
            <RequireRole roles={["coordinator", "principal", "exam_cell"]}>
              <ResultArchive />
            </RequireRole>
          }
        />
        <Route
          path="config"
          element={
            <RequireRole role="exam_cell">
              <ResultConfig />
            </RequireRole>
          }
        />
        <Route
          path="assessment"
          element={
            <RequireRole role="exam_cell">
              <AssessmentSetup />
            </RequireRole>
          }
        />
        <Route
          path="approval"
          element={
            <RequireRole role="exam_cell">
              <ResultApproval />
            </RequireRole>
          }
        />
      </Route>
    </Routes>
  );
};

export default App;
