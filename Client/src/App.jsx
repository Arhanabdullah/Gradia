import { Routes, Route } from "react-router-dom";

import Landing from "./pages/Landing";
import Login from "./pages/Login";
import DashboardLayout from "./components/dashboard/DashboardLayout";
import { useAuth } from "./context/AuthContext";
import { Navigate } from "react-router-dom";

import Overview from "./pages/Overview";
import ManageUsers from "./pages/admin/ManageUsers";
import ManageClasses from "./pages/admin/ManageClasses";
import ManageExams from "./pages/admin/ManageExams";
import AdminSheets from "./pages/admin/AdminSheets";
import MarksEntry from "./pages/teacher/MarksEntry";
import ReviewSheets from "./pages/hod/ReviewSheets";
import PublishSheets from "./pages/principal/PublishSheets";
import MyResults from "./pages/student/MyResults";
import Notifications from "./pages/student/Notifications";

const RequireRole = ({ role, children }) => {
  const { profile } = useAuth();
  if (!profile) return null;
  if (role && profile.role !== role) return <Navigate to="/app" replace />;
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
            <RequireRole role="admin">
              <ManageExams />
            </RequireRole>
          }
        />
        <Route
          path="sheets"
          element={
            <RequireRole role="admin">
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
      </Route>
    </Routes>
  );
};

export default App;
