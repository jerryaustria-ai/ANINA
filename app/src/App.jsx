import { Navigate, Route, Routes, NavLink, useNavigate } from "react-router-dom";
import { lazy, Suspense } from "react";
import { useAuth } from "./auth.jsx";
import Login from "./pages/Login.jsx";
import ClientDashboard from "./pages/ClientDashboard.jsx";
import ClientMembership from "./pages/ClientMembership.jsx";
import InstructorDashboard from "./pages/InstructorDashboard.jsx";
import AdminDashboard from "./pages/AdminDashboard.jsx";
import { toast } from "react-toastify";
import NotificationBell from "./components/NotificationBell.jsx";
import Landing from "./pages/Landing.jsx";
import PublicSchedule from "./pages/PublicSchedule.jsx";
import GuestBooking from "./pages/GuestBooking.jsx";
import GuestCheckout from "./pages/GuestCheckout.jsx";
import PaymentResult from "./pages/PaymentResult.jsx";
import ClientRecordDetails from "./pages/ClientRecordDetails.jsx";
import ProfileSettings from "./pages/ProfileSettings.jsx";
import Notifications from "./pages/Notifications.jsx";
const CheckInScanner = lazy(() => import("./pages/CheckInScanner.jsx"));

function Nav() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const tabs = {
    client: [["/dashboard", "My Bookings"], ["/dashboard/membership", "My Memberships"], ["/dashboard/profile", "Profile"]],
    instructor: [["/dashboard", "My Classes"], ["/dashboard/check-in", "QR Check-in"], ["/dashboard/profile", "Profile"]],
    admin: [["/dashboard", "Overview"], ["/dashboard/schedule", "Studio Schedule"], ["/dashboard/check-in", "QR Check-in"], ["/dashboard/approvals", "Schedule Approval"], ["/dashboard/audit-trail", "Audit Trail"], ["/dashboard/rooms", "Rooms"], ["/dashboard/people", "People"], ["/dashboard/class-titles", "Class Titles"], ["/dashboard/tiers", "Class Plans"], ["/dashboard/memberships", "Memberships"], ["/dashboard/profile", "Profile"]],
  }[user.role] || [];

  return (
    <nav className="app-nav">
      <span className="app-brand">ANINA</span>
      <div className="app-tabs">
        {tabs.map(([to, label]) => (
          <NavLink key={to} to={to} end className={({ isActive }) => "app-tab" + (isActive ? " active" : "")}>
            {label}
          </NavLink>
        ))}
      </div>
      <div className="spacer" />
      <NotificationBell user={user} />
      <div className="app-user">
        {user.picture && <img src={user.picture} alt="" />}
        <span>{user.name}</span>
        <span className={"role-pill " + user.role}>{user.role}</span>
      </div>
      <button className="btn ghost sm" onClick={() => { logout(); nav("/"); toast.info("You have been signed out."); }}>Sign out</button>
    </nav>
  );
}

function Dashboard() {
  const { user } = useAuth();
  return (
    <>
      <Nav />
      <Routes>
        {user.role === "client" && <Route index element={<ClientDashboard />} />}
        {user.role === "client" && <Route path="membership" element={<ClientMembership />} />}
        {user.role === "instructor" && <Route index element={<InstructorDashboard />} />}
        {["admin", "instructor"].includes(user.role) && <Route path="check-in" element={
          <Suspense fallback={<div className="spinner">Loading scanner…</div>}><CheckInScanner /></Suspense>
        } />}
        <Route path="profile" element={<ProfileSettings />} />
        <Route path="notifications" element={<Notifications />} />
        {user.role === "admin" && (
          <>
            <Route index element={<AdminDashboard view="overview" />} />
            <Route path="schedule" element={<AdminDashboard view="schedule" />} />
            <Route path="approvals" element={<AdminDashboard view="approvals" />} />
            <Route path="audit-trail" element={<AdminDashboard view="audit" />} />
            <Route path="rooms" element={<AdminDashboard view="rooms" />} />
            <Route path="people" element={<AdminDashboard view="people" />} />
            <Route path="class-titles" element={<AdminDashboard view="class-titles" />} />
            <Route path="tiers" element={<AdminDashboard view="tiers" />} />
            <Route path="memberships" element={<AdminDashboard view="memberships" />} />
            <Route path="clients/:clientId" element={<ClientRecordDetails />} />
          </>
        )}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </>
  );
}

function ProtectedDashboard() {
  const { user } = useAuth();
  return user ? <Dashboard /> : <Navigate to="/login" replace />;
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="spinner">Loading…</div>;

  return <Routes>
    <Route path="/" element={<Landing />} />
    <Route path="/schedule" element={<PublicSchedule />} />
    <Route path="/guest/book/:sessionId" element={<GuestBooking />} />
    <Route path="/guest/checkout/:orderId" element={<GuestCheckout />} />
    <Route path="/guest/payment-result/:orderId" element={<PaymentResult />} />
    <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <Login />} />
    <Route path="/register" element={user ? <Navigate to="/dashboard" replace /> : <Login mode="register" />} />
    <Route path="/dashboard/*" element={<ProtectedDashboard />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}
