import { Navigate, Route, Routes, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "./auth.jsx";
import Login from "./pages/Login.jsx";
import ClientDashboard from "./pages/ClientDashboard.jsx";
import ClientMembership from "./pages/ClientMembership.jsx";
import InstructorDashboard from "./pages/InstructorDashboard.jsx";
import AdminDashboard from "./pages/AdminDashboard.jsx";

function Nav() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const tabs = {
    client: [["/", "My Bookings"], ["/membership", "Membership"]],
    instructor: [["/", "My Classes"]],
    admin: [["/", "Studio Schedule"], ["/rooms", "Rooms"], ["/people", "People"], ["/tiers", "Tiers"], ["/memberships", "Memberships"]],
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
      <div className="app-user">
        {user.picture && <img src={user.picture} alt="" />}
        <span>{user.name}</span>
        <span className={"role-pill " + user.role}>{user.role}</span>
      </div>
      <button className="btn ghost sm" onClick={() => { logout(); nav("/"); }}>Sign out</button>
    </nav>
  );
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="spinner">Loading…</div>;
  if (!user) return <Login />;

  return (
    <>
      <Nav />
      <Routes>
        {user.role === "client" && <Route path="/" element={<ClientDashboard />} />}
        {user.role === "client" && <Route path="/membership" element={<ClientMembership />} />}
        {user.role === "instructor" && <Route path="/" element={<InstructorDashboard />} />}
        {user.role === "admin" && (
          <>
            <Route path="/" element={<AdminDashboard view="schedule" />} />
            <Route path="/rooms" element={<AdminDashboard view="rooms" />} />
            <Route path="/people" element={<AdminDashboard view="people" />} />
            <Route path="/tiers" element={<AdminDashboard view="tiers" />} />
            <Route path="/memberships" element={<AdminDashboard view="memberships" />} />
          </>
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
