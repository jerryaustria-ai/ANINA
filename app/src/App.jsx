import { Navigate, Route, Routes, NavLink, useLocation, useNavigate } from "react-router-dom";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
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
import CashEnrollmentConfirmation from "./pages/CashEnrollmentConfirmation.jsx";
import PaymentResult from "./pages/PaymentResult.jsx";
import ClientRecordDetails from "./pages/ClientRecordDetails.jsx";
import ProfileSettings from "./pages/ProfileSettings.jsx";
import Attendance from "./pages/Attendance.jsx";
import Avatar from "./components/Avatar.jsx";
const CheckInScanner = lazy(() => import("./pages/CheckInScanner.jsx"));

const MENU = {
  client: [
    ["/dashboard", "My Bookings", "bookings"],
    ["/schedule", "Published Schedule", "calendar"],
    ["/dashboard/membership", "My Plans", "plans"],
    ["/dashboard/profile", "Profile", "profile"],
  ],
  instructor: [
    ["/dashboard", "My Classes", "calendar"],
    ["/dashboard/attendance", "Attendance", "attendance"],
    ["/dashboard/check-in", "QR Check-in", "scan"],
    ["/dashboard/profile", "Profile", "profile"],
  ],
  admin: [
    ["/dashboard", "Overview", "home"],
    ["/dashboard/schedule", "Studio Schedule", "calendar"],
    ["/dashboard/approvals", "Schedule Approval", "approve"],
    ["/dashboard/attendance", "Attendance", "attendance"],
    ["/dashboard/check-in", "QR Check-in", "scan"],
    ["/dashboard/people", "People", "people"],
    ["/dashboard/class-titles", "Classes", "classes"],
    ["/dashboard/rooms", "Rooms", "rooms"],
    ["/dashboard/tiers", "Class Plans", "plans"],
    ["/dashboard/payments", "Payments", "payments"],
    ["/dashboard/memberships", "Memberships", "membership"],
    ["/dashboard/audit-trail", "Audit Trail", "audit"],
    ["/dashboard/profile", "Profile", "profile"],
  ],
};

function MenuIcon({ name }) {
  const paths = {
    home: <><path d="m3 10 9-7 9 7"/><path d="M5 9v11h14V9"/><path d="M9 20v-7h6v7"/></>,
    bookings: <><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 2v4M15 2v4M8 10h8M8 14h5"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
    plans: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h10M7 13h5"/><circle cx="17" cy="15" r="1"/></>,
    announce: <><path d="m3 11 15-6v14L3 13z"/><path d="M7 14v6h4l1-4"/></>,
    profile: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
    scan: <><path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/><path d="M9 9h6v6H9z"/></>,
    approve: <><path d="M9 11l2 2 4-5"/><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 3V1M16 3V1"/></>,
    attendance: <><path d="M5 3h14v18H5z"/><path d="m8 8 2 2 5-5M8 15h8M8 18h6"/></>,
    people: <><circle cx="9" cy="8" r="3"/><circle cx="17" cy="10" r="2"/><path d="M3 20a6 6 0 0 1 12 0M15 16a5 5 0 0 1 6 4"/></>,
    classes: <><path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h5"/></>,
    rooms: <><path d="M4 21V3h12v18M16 8h4v13M8 7h4M8 11h4M8 15h4"/></>,
    membership: <><circle cx="8" cy="12" r="5"/><path d="M13 9h8M13 15h8"/></>,
    payments: <><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/></>,
    audit: <><path d="M5 3h14v18H5z"/><path d="M9 7h6M9 11h6M9 15h4"/></>,
  };
  return <svg className="menu-icon" viewBox="0 0 24 24" aria-hidden="true"
    fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {paths[name] || paths.home}
  </svg>;
}

function DashboardNav({ sidebarOpen, setSidebarOpen, sidebarCollapsed, setSidebarCollapsed }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef(null);
  const tabs = MENU[user.role] || [];
  const current = [...tabs].sort((a, b) => b[0].length - a[0].length)
    .find(([to]) => to === "/dashboard" ? location.pathname === to : location.pathname.startsWith(to));
  const pageTitle = current?.[1] || "Dashboard";

  useEffect(() => {
    setSidebarOpen(false);
    setProfileOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    const close = (event) => {
      if (profileOpen && profileRef.current && !profileRef.current.contains(event.target)) setProfileOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [profileOpen]);

  return (
    <>
      {sidebarOpen && <button className="sidebar-scrim" aria-label="Close menu" onClick={() => setSidebarOpen(false)} />}
      <aside className={"app-sidebar" + (sidebarOpen ? " open" : "")}>
        <NavLink to="/" className="sidebar-brand">
          <img src="/assets/images/anina-logo.png" alt="Anina Wellness Sanctuary" />
        </NavLink>
        <nav className="sidebar-menu" aria-label="Dashboard navigation">
          {tabs.map(([to, label, icon], index) => (
            <NavLink key={`${to}-${label}`} to={to} end={to === "/dashboard" && index < 2}
              className={({ isActive }) => "sidebar-link" + (isActive ? " active" : "")}>
              <MenuIcon name={icon} /><span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <button className="sidebar-logout" onClick={() => {
          logout(); nav("/"); toast.info("You have been signed out.");
        }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4H4v16h6M14 8l4 4-4 4M18 12H8"/></svg>
          <span>Logout</span>
        </button>
      </aside>
      <header className="app-topbar">
        <div className="topbar-title">
          <button className="sidebar-toggle"
            aria-label={sidebarCollapsed ? "Show navigation" : "Hide navigation"}
            aria-expanded={sidebarOpen || !sidebarCollapsed}
            onClick={() => {
              if (window.matchMedia("(max-width: 900px)").matches) {
                setSidebarOpen((value) => !value);
              } else {
                setSidebarCollapsed((value) => {
                  const next = !value;
                  window.localStorage.setItem("anina-sidebar-collapsed", String(next));
                  return next;
                });
              }
            }}>
            <span/><span/><span/>
          </button>
          <strong>{pageTitle}</strong>
        </div>
        <div className="topbar-actions">
          <NotificationBell user={user} />
          <div className="profile-menu" ref={profileRef}>
            <button className="profile-trigger" onClick={() => setProfileOpen((value) => !value)}
              aria-expanded={profileOpen}>
              <Avatar src={user.picture} name={user.name} size={42} />
              <span className="profile-copy"><strong>{user.name}</strong><small>{user.role}</small></span>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9 5 5 5-5"/></svg>
            </button>
            {profileOpen && <div className="profile-dropdown">
              <button onClick={() => nav("/dashboard/profile")}><MenuIcon name="profile" />Profile Settings</button>
              <button className="danger-link" onClick={() => {
                logout(); nav("/"); toast.info("You have been signed out.");
              }}><MenuIcon name="audit" />Sign out</button>
            </div>}
          </div>
        </div>
      </header>
    </>
  );
}

function Dashboard() {
  const { user } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    window.localStorage.getItem("anina-sidebar-collapsed") === "true");
  return (
    <div className={"dashboard-shell" + (sidebarCollapsed ? " sidebar-collapsed" : "")}>
      <DashboardNav sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen}
        sidebarCollapsed={sidebarCollapsed} setSidebarCollapsed={setSidebarCollapsed} />
      <main className="dashboard-content">
        <Routes>
          {user.role === "client" && <Route index element={<ClientDashboard />} />}
          {user.role === "client" && <Route path="membership" element={<ClientMembership />} />}
          {user.role === "instructor" && <Route index element={<InstructorDashboard />} />}
          {["admin", "instructor"].includes(user.role) &&
            <Route path="attendance" element={<Attendance />} />}
          {["admin", "instructor"].includes(user.role) && <Route path="check-in" element={
            <Suspense fallback={<div className="spinner">Loading scanner…</div>}><CheckInScanner /></Suspense>
          } />}
          <Route path="profile" element={<ProfileSettings />} />
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
              <Route path="payments" element={<AdminDashboard view="payments" />} />
              <Route path="memberships" element={<AdminDashboard view="memberships" />} />
              <Route path="clients/:clientId" element={<ClientRecordDetails />} />
            </>
          )}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
    </div>
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
    <Route path="/guest/cash-confirm" element={<CashEnrollmentConfirmation />} />
    <Route path="/guest/payment-result/:orderId" element={<PaymentResult />} />
    <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <Login />} />
    <Route path="/register" element={user ? <Navigate to="/dashboard" replace /> : <Login mode="register" />} />
    <Route path="/dashboard/*" element={<ProtectedDashboard />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}
