import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth.jsx";

const services = [
  {
    title: "Mobility",
    text: "Build usable range, joint control, and confident movement through every stage of life.",
    image: "/assets/images/program-mobility.jpg",
  },
  {
    title: "Strength",
    text: "Progressive, coached resistance training designed for resilience and long-term health.",
    image: "/assets/images/program-strength.jpg",
  },
  {
    title: "Recovery",
    text: "Restore, recharge, and support consistent progress in a calm sanctuary environment.",
    image: "/assets/images/program-recovery.jpg",
  },
];

export default function Landing() {
  const { user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  return <div className="landing">
    <header className="landing-nav">
      <a className="landing-brand" href="#home" aria-label="ANINA home">
        <img src="/assets/images/anina-logo.png" alt="ANINA Wellness Sanctuary" />
      </a>
      <button className="landing-menu" aria-label="Toggle navigation" aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}>☰</button>
      <nav className={menuOpen ? "open" : ""} aria-label="Main navigation">
        <a href="#about" onClick={() => setMenuOpen(false)}>About</a>
        <a href="#services" onClick={() => setMenuOpen(false)}>Services</a>
        <Link to="/schedule" onClick={() => setMenuOpen(false)}>Schedule</Link>
        <a href="#contact" onClick={() => setMenuOpen(false)}>Contact</a>
        {user ? <Link className="landing-login" to="/dashboard">Dashboard</Link> : <>
          <Link className="landing-login" to="/login">Login</Link>
          <Link className="landing-register" to="/register">Register</Link>
        </>}
      </nav>
    </header>

    <main>
      <section className="landing-hero" id="home">
        <img src="/assets/images/hero.jpg" alt="ANINA Wellness Sanctuary training space" />
        <div className="landing-hero-shade" />
        <div className="landing-hero-content">
          <p className="landing-kicker">BF Homes · Parañaque</p>
          <h1>Train once.<br />For a longer life.</h1>
          <p>Longevity, mobility, strength, and recovery under one roof—guided by thoughtful coaching and built for the long game.</p>
          <div className="landing-actions">
            <Link className="landing-primary" to="/schedule">View Schedule</Link>
            <a className="landing-secondary" href="#services">Explore Services</a>
          </div>
        </div>
      </section>

      <section className="landing-about" id="about">
        <div>
          <p className="landing-kicker">The ANINA approach</p>
          <h2>Your body is one system. Your training should be too.</h2>
        </div>
        <p>ANINA brings assessment, coached movement, progressive strength, and recovery together in one calm space. Every session is designed to help you move better now while building capacity for the years ahead.</p>
      </section>

      <section className="landing-services" id="services">
        <div className="landing-section-head">
          <p className="landing-kicker">Our services</p>
          <h2>One practice, built around you.</h2>
        </div>
        <div className="landing-service-grid">
          {services.map((service) => <article key={service.title}>
            <img src={service.image} alt="" />
            <div><h3>{service.title}</h3><p>{service.text}</p></div>
          </article>)}
        </div>
      </section>

      <section className="landing-cta">
        <p className="landing-kicker">Ready when you are</p>
        <h2>Find a class that fits your next chapter.</h2>
        <p>Sign in to view the live schedule, manage your class plans, and request your spot.</p>
        <Link className="landing-primary" to="/schedule">View Schedule</Link>
      </section>
    </main>

    <footer className="landing-footer" id="contact">
      <div><strong>ANINA Wellness Sanctuary</strong>
        <p>Longevity · Mobility · Strength · Recovery</p></div>
      <div><p>hello@aninasanctuary.ph</p><p>South Metro Manila, Philippines</p></div>
      <div><p>Mon–Sat 6am–9pm</p><p>Sun 7am–1pm</p></div>
      <p className="landing-copyright">© {new Date().getFullYear()} ANINA Wellness Sanctuary</p>
    </footer>
  </div>;
}
