import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth.jsx";
import { api } from "../api.js";

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

const marqueeItems = [
  "Longevity", "Mobility", "Strength", "Recovery", "Healthspan",
  "Breathwork", "Balance", "Resilience", "Coaching", "Community",
];

export default function Landing() {
  const { user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [cms, setCms] = useState(null);

  useEffect(() => {
    api("/public/landing").then(({ landing }) => {
      setCms(landing);
      if (landing?.seo?.title) document.title = landing.seo.title;
      const description = document.querySelector('meta[name="description"]');
      if (description && landing?.seo?.description) description.content = landing.seo.description;
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const updateNav = () => setScrolled(window.scrollY > 24);
    updateNav();
    window.addEventListener("scroll", updateNav, { passive: true });

    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.14, rootMargin: "0px 0px -7% 0px" });

    document.querySelectorAll("[data-reveal]").forEach((element) => revealObserver.observe(element));
    return () => {
      window.removeEventListener("scroll", updateNav);
      revealObserver.disconnect();
    };
  }, []);

  const hero = cms?.hero || {};
  const visibleSections = [...(cms?.sections || [])]
    .filter((section) => section.visible)
    .sort((a, b) => a.order - b.order);
  const sectionByType = (type) => visibleSections.find((section) => section.type === type);
  const about = sectionByType("about");
  const servicesSection = sectionByType("services");
  const serviceItems = servicesSection?.content?.items?.length ? servicesSection.content.items : services;
  const cta = sectionByType("cta");

  return <div className="landing">
    <header className={`landing-nav${scrolled ? " is-scrolled" : ""}`}>
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
        <img src={hero.image || "/assets/images/hero.jpg"} alt="ANINA Wellness Sanctuary training space" />
        <div className="landing-hero-shade" />
        <div className="landing-hero-content">
          <p className="landing-kicker">{hero.kicker || "BF Homes · Parañaque"}</p>
          <h1>{(hero.headline || "Train once.\nFor a longer life.").split("\n").map((line, index) =>
            <span key={`${line}-${index}`}>{line}{index === 0 && <br />}</span>)}</h1>
          <p>{hero.description || "Longevity, mobility, strength, and recovery under one roof—guided by thoughtful coaching and built for the long game."}</p>
          <div className="landing-actions">
            <Link className="landing-primary" to={hero.primaryUrl || "/schedule"}>{hero.primaryLabel || "View Schedule"}</Link>
            <a className="landing-secondary" href={hero.secondaryUrl || "#services"}>{hero.secondaryLabel || "Explore Services"}</a>
          </div>
        </div>
        <a className="landing-scroll-cue" href="#about" aria-label="Scroll to content">
          <span>Scroll</span><i />
        </a>
      </section>

      <div className="landing-marquee" aria-hidden="true">
        <div className="landing-marquee-track">
          {[...marqueeItems, ...marqueeItems].map((item, index) =>
            <span key={`${item}-${index}`}>{item}<b>·</b></span>)}
        </div>
      </div>

      {(!cms || about) && <section className="landing-about" id="about">
        <div className="landing-reveal" data-reveal>
          <p className="landing-kicker">{about?.content?.kicker || "The ANINA approach"}</p>
          <h2>{about?.content?.headline || "Your body is one system. Your training should be too."}</h2>
        </div>
        <p className="landing-reveal" data-reveal>{about?.content?.text || "ANINA brings assessment, coached movement, progressive strength, and recovery together in one calm space. Every session is designed to help you move better now while building capacity for the years ahead."}</p>
      </section>}

      {(!cms || servicesSection) && <section className="landing-services" id="services">
        <div className="landing-section-head landing-reveal" data-reveal>
          <p className="landing-kicker">{servicesSection?.content?.kicker || "Our services"}</p>
          <h2>{servicesSection?.content?.headline || "One practice, built around you."}</h2>
        </div>
        <div className="landing-service-grid">
          {serviceItems.map((service, index) => <article className="landing-reveal" data-reveal
            style={{ "--reveal-delay": `${index * 110}ms` }} key={service.title}>
            <div className="landing-service-image"><img src={service.image} alt="" /></div>
            <div><h3>{service.title}</h3><p>{service.text}</p></div>
          </article>)}
        </div>
      </section>}

      {visibleSections.filter((section) => !["about", "services", "cta"].includes(section.type)).map((section) =>
        <section className="landing-cta landing-reveal" data-reveal key={section.key}>
          <p className="landing-kicker">{section.title}</p>
          <h2>{section.content?.headline || section.title}</h2>
          {section.content?.text && <p>{section.content.text}</p>}
        </section>)}

      {(!cms || cta) && <section className="landing-cta landing-reveal" data-reveal>
        <p className="landing-kicker">{cta?.content?.kicker || "Ready when you are"}</p>
        <h2>{cta?.content?.headline || "Find a class that fits your next chapter."}</h2>
        <p>{cta?.content?.text || "Sign in to view the live schedule, manage your class plans, and request your spot."}</p>
        <Link className="landing-primary" to={cta?.content?.buttonUrl || "/schedule"}>{cta?.content?.buttonLabel || "View Schedule"}</Link>
      </section>}
    </main>

    <footer className="landing-footer" id="contact">
      <div><strong>ANINA Wellness Sanctuary</strong>
        <p>Longevity · Mobility · Strength · Recovery</p></div>
      <div><p>{cms?.contact?.email || "hello@aninasanctuary.ph"}</p><p>{cms?.contact?.address || "South Metro Manila, Philippines"}</p></div>
      <div><p>{cms?.businessHours || "Mon–Sat 6am–9pm · Sun 7am–1pm"}</p>
        {cms?.legalLinks?.terms && <a href={cms.legalLinks.terms}>Terms</a>}
        {cms?.legalLinks?.privacy && <a href={cms.legalLinks.privacy}>Privacy</a>}</div>
      <p className="landing-copyright">© {new Date().getFullYear()} ANINA Wellness Sanctuary</p>
    </footer>
  </div>;
}
