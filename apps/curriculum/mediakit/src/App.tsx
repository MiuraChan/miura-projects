// Francesco Saccullo — Mediakit 2026
import { useState, useEffect } from "react";
import imgPortrait from "@/imports/profile-photo.jpg";
import imgContactPhoto from "@/imports/contact-photo.jpg";

type Route = "home" | "profile" | "projects" | "contact";

const EMAIL = "saccullo.francesco@gmail.com";

// ── SVG icons ──────────────────────────────────────────────────────────────

function IconPerson({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden>
      <circle cx="8" cy="4.5" r="2.5" />
      <path d="M2.5 13.5c0-3.038 2.462-5.5 5.5-5.5s5.5 2.462 5.5 5.5" strokeWidth="0" />
    </svg>
  );
}

function IconFigma({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <rect x="2" y="2" width="5" height="5" rx="1.5" fill="currentColor" opacity=".9" />
      <rect x="9" y="2" width="5" height="5" rx="2.5" fill="currentColor" opacity=".65" />
      <rect x="2" y="9" width="5" height="5" rx="1.5" fill="currentColor" opacity=".65" />
      <circle cx="11.5" cy="11.5" r="2.5" fill="currentColor" opacity=".4" />
    </svg>
  );
}

function IconTerminal({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className={className} aria-hidden>
      <polyline points="2,5 6,8 2,11" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </svg>
  );
}

function IconMail({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className} aria-hidden>
      <rect x="2" y="5" width="16" height="12" rx="1.5" />
      <polyline points="2,5 10,12 18,5" />
    </svg>
  );
}

function IconPhone({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M3 3.5c0-.276.224-.5.5-.5h3l1.5 4-2 1.5c1 2 3 4 5 5l1.5-2 4 1.5v3c0 .276-.224.5-.5.5C8.5 17 3 11.5 3 3.5z"/>
    </svg>
  );
}

function IconArrow({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className={className} aria-hidden>
      <line x1="2" y1="8" x2="13" y2="8" />
      <polyline points="9,4 13,8 9,12" />
    </svg>
  );
}

// ── Data ───────────────────────────────────────────────────────────────────

const skills = [
  { label: "Design", note: "14 years designing interfaces people actually enjoy using." },
  { label: "Software Engineering", note: "React, TypeScript, Vite — clean components, zero cruft." },
  { label: "Product Management", note: "From brief to backlog to shipped." },
  { label: "AI Integration", note: "LLM pipelines, prompt engineering, agent tooling." },
  { label: "AI Strategy", note: "" },
  { label: "Storytelling", note: "" },
  { label: "Design Systems", note: "" },
  { label: "Motion & Interaction", note: "" },
  { label: "Podcasting", note: "" },
  { label: "Sound Design", note: "" },
];

const experience = [
  { company: "INDEPENDENT PROJECTS", period: "2026–Present", role: "Software Engineer, Designer & AI Manager", location: "", note: "Developing next-generation AI-driven interfaces and product prototypes." },
  { company: "JOBRAPIDO", period: "2022–2026", role: "Software Engineer | Front-end Lead for three years", location: "Milan", note: "Served as Front-end Lead and sole front-end engineer for three years, with full responsibility for front-end design, architecture and development. Led technical decisions and built responsive search applications with modern JavaScript frameworks." },
  { company: "ENDO-FAP DON ORIONE", period: "2022–2023", role: "Lecturer, App Design & Development", location: "", note: "Lecturing and mentoring students on design principles and mobile architecture." },
  { company: "IDEGAMI", period: "2020–2023", role: "Designer & Software Engineer", location: "", note: "Designed cohesive digital design systems and engineered application code." },
  { company: "HIBYE", period: "2017–2020", role: "Lead Software Engineer & Designer", location: "Milan", note: "Took broad ownership of the project, combining front-end implementation with technical and design direction. Coordinated company leadership and the external backend provider, acting as the technical lead for shared decisions and front-end/backend integration. Developed component architectures and micro-interactions as part of the product experience." },
  { company: "ECRM ITALIA", period: "2015–2017", role: "Designer / Developer", location: "Milan", note: "Designed digital experiences at the intersection of interface and implementation." },
];

type Tool = { label: string; icon: React.ReactNode };

const tools: Tool[] = [
  { label: "Francesco — concept, direction & validation", icon: <IconPerson /> },
  { label: "Figma — design & prototyping", icon: <IconFigma /> },
  { label: "Codex — AI-assisted development", icon: <IconTerminal /> },
];

const projects = [
  {
    id: "grayfox",
    number: "01",
    title: "Grayfox",
    caseStudy: [{label:"Problem",text:"Move from source footage to reviewable cuts and vertical clips without losing control of the output."},{label:"My contribution",text:"Product direction, design and software development, connecting editing workflows with AI assistance."},{label:"Decision and trade-off",text:"Keep browser video processing local and make export real. The bounded web demo supports short WebM exports; semantic event recognition and native editor integrations remain desktop features."},{label:"Try it",text:"Use the original sample video, adjust the edit and export a clip. The public demo has a 500 MB source limit and a 60-second selected-export limit."}],
    href: "/grayfox/",
    discipline: "VIDEO EDITING / AI / PRODUCT",
    description: "A video editing environment that integrates cutting tools and AI assistance to work on the rhythm, tone and structure of content.",
    color: "#5e168f",
    screenshot: "/grayfox-figma-workspace.png",
    screenshotAlt: "Grayfox — current Figma design showing the Story clips workspace",
    wrapperStyle: { position: "relative", overflow: "hidden", aspectRatio: "16/9" } as React.CSSProperties,
    imgStyle: {"position":"absolute","width":"137.931%","maxWidth":"none","height":"auto","left":"-5.172%","top":"-21.456%","margin":0} as React.CSSProperties,
  },
  {
    id: "meiLing",
    number: "02",
    title: "Mei Ling",
    caseStudy: [{label:"Problem",text:"Make an AI assistant useful inside a creative workflow rather than leaving its suggestions in an isolated chat."},{label:"My contribution",text:"Interaction design, application development and AI integration for a codec-inspired assistant."},{label:"Decision and trade-off",text:"Separate the public guest session from private memory. Keep source-backed news distinct from evergreen ideas and show when current evidence is unavailable, instead of filling gaps with invented facts."},{label:"Try it",text:"Enter a guest name, ask a question in Italian or English and inspect the Intel panel. The public demo uses a dated RSS snapshot; its freshness and evidence limits remain visible."}],
    discipline: "DESKTOP ASSISTANT / AI / INTERFACE",
    description: "A desktop assistant with a codec-inspired interface, designed to make interactions with AI tools and workflows feel more personal.",
    href: "/meiling/",
    color: "#ff4b1f",
    screenshot: "/mei-ling-figma-codec.png",
    screenshotAlt: "Mei Ling — connected desktop Codec exported from Figma",
    wrapperStyle: { position: "relative", overflow: "hidden", aspectRatio: "16/9" } as React.CSSProperties,
    imgStyle: {"position":"absolute","inset":0,"width":"100%","height":"100%","objectFit":"contain","objectPosition":"center"} as React.CSSProperties,
  },
];

// ── Nav ────────────────────────────────────────────────────────────────────

const navItems: Array<{ id: Route; label: string }> = [
  { id: "profile", label: "Profile" },
  { id: "projects", label: "Projects" },
  { id: "contact", label: "Social & Contact" },
];

// ── App ────────────────────────────────────────────────────────────────────

export default function App() {
  const [active, setActive] = useState<Route>(() => ["profile", "projects", "contact"].includes(location.hash.slice(1).split("/")[0]) ? location.hash.slice(1).split("/")[0] as Route : "home");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => { const sync = () => { const route = location.hash.slice(1).split("/")[0]; setActive(["profile", "projects", "contact"].includes(route) ? route as Route : "home"); }; window.addEventListener("hashchange", sync); return () => window.removeEventListener("hashchange", sync); }, []);

  const go = (route: Route) => {
    location.hash = route;
    setActive(route);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="min-h-screen bg-[#f4efe6] text-[#121212]">
      {/* ── Header ── */}
      <header className="sticky top-0 z-30 border-b border-[#121212] bg-[#f4efe6]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1240px] items-center justify-between gap-4 px-5 py-4 md:px-8">
          <button
            onClick={() => go("home")}
            className="text-left font-['IBM_Plex_Mono:SemiBold',sans-serif] text-[10px] tracking-[.16em] hover:text-[#ff4b1f] transition-colors"
            aria-label="Home — Francesco Saccullo Mediakit"
          >
            FRANCESCO SACCULLO <span className="text-[#ff4b1f]">/</span> MEDIAKIT
          </button>

          {/* Desktop nav */}
          <nav aria-label="Main navigation" className="hidden items-center gap-1 sm:flex">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => go(item.id)}
                aria-current={active === item.id ? "page" : undefined}
                className={[
                  "px-3 py-1.5 font-['IBM_Plex_Mono:SemiBold',sans-serif] text-[10px] tracking-[.14em] transition-colors",
                  active === item.id
                    ? "bg-[#121212] text-[#f4efe6]"
                    : "hover:text-[#ff4b1f]",
                ].join(" ")}
              >
                {item.label.toUpperCase()}
              </button>
            ))}
          </nav>

          {/* Mobile hamburger */}
          <button
            className="flex flex-col gap-[5px] sm:hidden"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span className={`block h-px w-5 bg-[#121212] transition-all ${menuOpen ? "translate-y-[7px] rotate-45" : ""}`} />
            <span className={`block h-px w-5 bg-[#121212] transition-opacity ${menuOpen ? "opacity-0" : ""}`} />
            <span className={`block h-px w-5 bg-[#121212] transition-all ${menuOpen ? "-translate-y-[7px] -rotate-45" : ""}`} />
          </button>
        </div>

        {/* Mobile nav panel */}
        {menuOpen && (
          <div className="border-t border-[#121212] bg-[#f4efe6] px-5 py-4 sm:hidden">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => go(item.id)}
                aria-current={active === item.id ? "page" : undefined}
                className="block w-full py-3 text-left font-['IBM_Plex_Mono:SemiBold',sans-serif] text-[11px] tracking-[.14em] border-b border-[#121212]/10 last:border-b-0 hover:text-[#ff4b1f]"
              >
                {item.label.toUpperCase()}
              </button>
            ))}
          </div>
        )}
      </header>

      {/* ── Pages ── */}
      <main>
        {active === "home" && <PageHome onProjects={() => go("projects")} />}
        {active === "profile" && <PageProfile />}
        {active === "projects" && <PageProjects />}
        {active === "contact" && <PageContact />}
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-[#121212] bg-[#f4efe6]">
        <div className="mx-auto flex max-w-[1240px] items-center justify-between gap-4 px-5 py-4 md:px-8">
          <p className="font-['IBM_Plex_Mono:Regular',sans-serif] text-[10px] tracking-[.1em] text-[#121212]/50">
            © 2026 FRANCESCO SACCULLO
          </p>
          <a
            href={`mailto:${EMAIL}`}
            className="font-['IBM_Plex_Mono:Regular',sans-serif] text-[10px] tracking-[.1em] text-[#121212]/50 hover:text-[#ff4b1f] transition-colors"
          >
            {EMAIL}
          </a>
        </div>
      </footer>
    </div>
  );
}

// ── Page: Home ─────────────────────────────────────────────────────────────

function PageHome({ onProjects }: { onProjects: () => void }) {
  return (
    <section className="relative mx-auto flex min-h-[calc(100vh-58px)] max-w-[1240px] flex-col justify-between overflow-hidden px-5 py-10 md:px-8 md:py-16">
      {/* Background accent */}

      {/* Eyebrow */}
      <p className="relative font-['IBM_Plex_Mono:SemiBold',sans-serif] text-[10px] tracking-[.18em] text-[#ff4b1f]">
        FRANCESCO SACCULLO / MEDIAKIT — 2026
      </p>

      {/* Hero copy */}
      <div className="relative py-14 md:py-20">
        <h1 className="font-['Archivo:ExtraBold',sans-serif] text-[clamp(2.8rem,8.5vw,7.8rem)] leading-[.84] tracking-[-.075em] text-[#121212]">
          TECHNICAL VISION.<br />
          <span className="text-[#ff4b1f]">HANDS-ON</span><br />
          DELIVERY.
        </h1>

        <p className="mt-8 max-w-[580px] font-['Archivo:Regular',sans-serif] text-[clamp(1rem,1.6vw,1.2rem)] leading-relaxed text-[#121212]/80">
          I'm Francesco Saccullo. I connect technical leadership, software development, design and AI integration. From architecture decisions to working interfaces, I turn a broad view of the product into concrete implementation choices.
        </p>

        {/* CTAs */}
        <div className="mt-10 flex flex-wrap items-center gap-4">
          <button
            onClick={onProjects}
            className="group flex items-center gap-3 bg-[#ff4b1f] px-6 py-3.5 font-['IBM_Plex_Mono:SemiBold',sans-serif] text-[11px] tracking-[.12em] text-white transition-transform hover:-translate-y-0.5"
          >
            EXPLORE THE PROJECTS
            <IconArrow className="w-4 h-4 transition-transform group-hover:translate-x-1" />
          </button>
          <a
            href={`mailto:${EMAIL}`}
            className="flex items-center gap-3 border border-[#121212] px-6 py-3.5 font-['IBM_Plex_Mono:SemiBold',sans-serif] text-[11px] tracking-[.12em] hover:bg-[#121212] hover:text-[#f4efe6] transition-colors"
          >
            LET'S COLLABORATE
          </a>
        </div>
      </div>

      {/* Bottom strip */}
      <div className="relative flex flex-wrap items-end justify-between gap-4 border-t border-[#121212] pt-5">
        <div className="flex flex-wrap gap-x-8 gap-y-2">
          {["Technical leadership", "Software development", "Design", "AI integration"].map((role) => (
            <span key={role} className="font-['IBM_Plex_Mono:Regular',sans-serif] text-[10px] tracking-[.12em] text-[#121212]/50">
              {role.toUpperCase()}
            </span>
          ))}
        </div>
        <span className="font-['IBM_Plex_Mono:Regular',sans-serif] text-[10px] tracking-[.1em] text-[#121212]/40">
          PIACENZA, IT
        </span>
      </div>
    </section>
  );
}

// ── Page: Profile ──────────────────────────────────────────────────────────

function PageProfile() {
  return (
    <section className="mx-auto max-w-[1240px] px-5 py-10 md:px-8 md:py-14">
      {/* Section label */}
      <div className="mb-8 flex items-baseline justify-between border-b border-[#121212] pb-4">
        <h2 className="font-['Archivo:ExtraBold',sans-serif] text-[clamp(2.4rem,6vw,5rem)] leading-none tracking-[-.07em]">
          PROFILE
        </h2>
        <p className="font-['IBM_Plex_Mono:SemiBold',sans-serif] text-[10px] tracking-[.15em] text-[#ff4b1f]">
          14 YEARS OF PRACTICE
        </p>
      </div>

      <div className="mb-8 flex flex-wrap justify-end gap-3"><a href="/Francesco-Saccullo_CV.pdf?v=20261103" download="Francesco-Saccullo_CV.pdf" className="inline-flex items-center gap-3 border border-[#121212] px-5 py-3 font-['IBM_Plex_Mono:SemiBold',sans-serif] text-[11px] tracking-[.1em] transition-colors hover:bg-[#121212] hover:text-[#f4efe6] focus-visible:outline-2 focus-visible:outline-offset-4" aria-label="Download Francesco Saccullo CV in English as PDF"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></svg>DOWNLOAD CV · EN (PDF)</a><a href="/Francesco-Saccullo_CV_IT.pdf?v=20261103" download="Francesco-Saccullo_CV_IT.pdf" className="inline-flex items-center gap-3 border border-[#121212] px-5 py-3 font-['IBM_Plex_Mono:SemiBold',sans-serif] text-[11px] tracking-[.1em] transition-colors hover:bg-[#121212] hover:text-[#f4efe6] focus-visible:outline-2 focus-visible:outline-offset-4" aria-label="Download Francesco Saccullo CV in Italian as PDF"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></svg>DOWNLOAD CV · IT (PDF)</a></div>

      {/* Photo + intro + skills grid */}
      <div className="grid gap-8 lg:grid-cols-[340px_1fr]">
        {/* Left: photo + contacts */}
        <div className="flex flex-col gap-6">
          <div className="relative overflow-hidden rounded-[16px] border border-[#121212]" style={{ aspectRatio: "3/4", maxHeight: 460 }}>
            <img
              src={imgPortrait}
              alt="Francesco Saccullo — designer, developer and AI specialist"
              className="absolute inset-0 h-full w-full object-cover"
              style={{ objectPosition: "center 38%" }}
            />
          </div>

          <div>
            <p className="font-['Archivo:ExtraBold',sans-serif] text-[22px] leading-tight tracking-[-0.04em]">FRANCESCO SACCULLO</p>
            <p className="mt-1 font-['IBM_Plex_Mono:SemiBold',sans-serif] text-[11px] tracking-[.05em] text-[#164bce]">
              DESIGNER, SOFTWARE ENGINEER &amp; AI SPECIALIST
            </p>
          </div>

          {/* Contact */}
          <div className="flex flex-col gap-2">
            <p className="font-['IBM_Plex_Mono:SemiBold',sans-serif] text-[10px] tracking-[.18em] text-[#ff4b1f]">CONTACT</p>
            {[
              { type: "EMAIL", value: EMAIL, href: `mailto:${EMAIL}` },
              { type: "LOCATION", value: "Piacenza, IT", href: null },
            ].map((c) => (
              <div key={c.type} className="flex items-baseline gap-3">
                <span className="w-[64px] shrink-0 font-['IBM_Plex_Mono:SemiBold',sans-serif] text-[9px] tracking-[.1em] text-[#121212]/40">
                  {c.type}
                </span>
                {c.href ? (
                  <a href={c.href} className="font-['IBM_Plex_Mono:Regular',sans-serif] text-[11px] hover:text-[#164bce] transition-colors">
                    {c.value}
                  </a>
                ) : (
                  <span className="font-['IBM_Plex_Mono:Regular',sans-serif] text-[11px]">{c.value}</span>
                )}
              </div>
            ))}
          </div>

          {/* Expertise tags */}
          <div className="flex flex-col gap-2">
            <p className="font-['IBM_Plex_Mono:SemiBold',sans-serif] text-[10px] tracking-[.18em] text-[#121212]/50">EXPERTISE</p>
            <p className="font-['Archivo:SemiBold',sans-serif] text-[13px] leading-relaxed">
              DESIGN • SOFTWARE DEVELOPMENT • TECHNICAL LEADERSHIP • PRODUCT • AI
            </p>
          </div>
        </div>

        {/* Right: skills + experience */}
        <div className="flex flex-col gap-10">
          {/* Skills */}
          <div>
            <p className="mb-4 font-['IBM_Plex_Mono:SemiBold',sans-serif] text-[10px] tracking-[.18em] text-[#ff4b1f]">SKILLS</p>
            <div className="flex flex-col">
              {skills.map((skill, i) => (
                <div
                  key={skill.label}
                  className={`flex flex-col gap-0.5 py-3 ${i < skills.length - 1 ? "border-b border-[#121212]/12" : ""}`}
                >
                  <p className="font-['Archivo:Bold',sans-serif] text-[14px]">{skill.label}</p>
                  {skill.note ? (
                    <p className="font-['Archivo:Regular',sans-serif] text-[12px] text-[#121212]/60 leading-snug">{skill.note}</p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          {/* Experience */}
          <div>
            <p className="mb-4 font-['IBM_Plex_Mono:SemiBold',sans-serif] text-[10px] tracking-[.18em] text-[#ff4b1f]">EXPERIENCE</p>
            <div className="flex flex-col gap-1">
              {experience.map((item) => (
                <div
                  key={item.company}
                  className="flex flex-col gap-0.5 border-b border-[#121212]/10 py-3 last:border-b-0"
                >
                  <div className="flex items-baseline justify-between gap-3 flex-wrap">
                    <span className="flex items-center gap-2 font-['Archivo:Bold',sans-serif] text-[15px]">
                      <i className="inline-block size-1.5 rounded-full bg-[#ff4b1f]" aria-hidden />
                      {item.company}
                    </span>
                    <span className="font-['IBM_Plex_Mono:SemiBold',sans-serif] text-[11px] text-[#164bce] whitespace-nowrap">
                      {item.period}
                    </span>
                  </div>
                  <p className="font-['Archivo:Medium',sans-serif] text-[13px]">
                    {item.role}
                    {item.location && (
                      <em className="ml-2 font-['IBM_Plex_Mono:Regular',sans-serif] text-[10px] not-italic text-[#5e168f]">
                        • {item.location}
                      </em>
                    )}
                  </p>
                  <p className="font-['Archivo:Regular',sans-serif] text-[12px] leading-snug text-[#121212]/75">{item.note}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Education + Credentials */}
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <p className="mb-3 font-['IBM_Plex_Mono:SemiBold',sans-serif] text-[10px] tracking-[.18em] text-[#164bce]">EDUCATION</p>
              <div className="space-y-3 font-['Archivo:Regular',sans-serif] text-[12px]">
                <p>
                  <strong className="font-['Archivo:Bold',sans-serif] text-[13px] block">Liceo Artistico Bruno Cassinari</strong>
                  Audio Engineering &amp; Sound Design
                </p>
                <p>
                  <strong className="font-['Archivo:Bold',sans-serif] text-[13px] block">Infomedia Formazione</strong>
                  Web Design
                </p>
                <p>
                  <strong className="font-['Archivo:Bold',sans-serif] text-[13px] block">NAM Milano</strong>
                  Sound Design Specialist
                </p>
              </div>
            </div>
            <div>
              <p className="mb-3 font-['IBM_Plex_Mono:SemiBold',sans-serif] text-[10px] tracking-[.18em] text-[#164bce]">CREDENTIALS</p>
              <div className="space-y-3 font-['Archivo:Regular',sans-serif] text-[12px]">
                <p>
                  <strong className="font-['Archivo:Bold',sans-serif] block">JavaScript Essential Training</strong>
                  <span className="font-['IBM_Plex_Mono:Regular',sans-serif] text-[10px] text-[#121212]/55">Lynda / LinkedIn</span>
                </p>
                <p>
                  <strong className="font-['Archivo:Bold',sans-serif] block">React Native &amp; Redux</strong>
                  <span className="font-['IBM_Plex_Mono:Regular',sans-serif] text-[10px] text-[#121212]/55">Advanced Implementation</span>
                </p>
                <p>
                  <strong className="font-['Archivo:Bold',sans-serif] block">GOL 1: Artificial Intelligence</strong>
                  <span className="font-['IBM_Plex_Mono:Regular',sans-serif] text-[10px] text-[#121212]/55">IAL: Innovazione Apprendimento Lavoro</span>
                </p>
              </div>
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}

// ── Page: Projects ─────────────────────────────────────────────────────────

function PageProjects() {
  return (
    <section className="mx-auto max-w-[1240px] px-5 py-10 md:px-8 md:py-14">
      {/* Header */}
      <div className="mb-10 flex items-baseline justify-between border-b border-[#121212] pb-5 flex-wrap gap-4">
        <h2 className="font-['Archivo:ExtraBold',sans-serif] text-[clamp(2.4rem,6vw,5rem)] leading-none tracking-[-.07em]">
          MY PROJECTS
        </h2>
        <p className="max-w-[340px] font-['Archivo:Regular',sans-serif] text-[14px] leading-snug text-[#121212]/70">
          Professional case studies and independent tools: the context, my role and the decisions behind each piece of work.
        </p>
      </div>

      <article className="mb-8 border border-[#121212]/20 p-6"><h3 className="text-2xl font-bold mb-3">Jobrapido / Modernising a legacy application incrementally</h3><p className="mb-3">Context: Jobrapido is a job-search platform. I worked there from 2022 to 2026, including three years as Front-end Lead and sole front-end engineer, responsible for front-end design, architecture and development. This case concerns the existing search application and how to evolve it while continuing product delivery.</p><p className="mb-3">A full rewrite was too expensive: it would interrupt delivery and require backend involvement. I chose to reserve a few hours within sprints, create a separate copy and start building Next.js components that could be introduced into the existing application gradually.</p><p className="mb-3">The trade-off was slower, incremental change instead of a disruptive replacement. New components began entering the existing product; I do not claim a completed migration or an unmeasured performance gain.</p></article>
      <article className="mb-8 border border-[#121212]/20 p-6"><h3 className="text-2xl font-bold mb-3">HiBye / Owning delivery across design and development</h3><p className="mb-3">Context: At HiBye, from 2017 to 2020, I was Lead Software Engineer &amp; Designer with broad responsibility for the application project. I developed the front-end and directed its design and technical implementation; an external company provided the backend.</p><p className="mb-3">My role connected company leadership with the backend provider. I coordinated the parties as technical lead, bringing business decisions, front-end requirements and backend integration into the same delivery process.</p><p className="mb-3">Alongside that coordination, I built component architectures and micro-interactions. This case illustrates hands-on project ownership across design, development and external technical collaboration.</p></article>
      {/* Project cards */}
      <div className="flex flex-col gap-0 border-t border-[#121212]">
        {projects.map((project) => (
          <article
            key={project.id}
            id={project.id}
            className="flex flex-col border-b border-[#121212] last:border-b-0 py-8 md:py-10"
          >
            {/* Top row: number + meta + description + badges */}
            <div className="grid md:grid-cols-[56px_1fr] md:gap-8">
              {/* Number */}
              <div className="mb-3 md:mb-0">
                <span
                  className="font-['IBM_Plex_Mono:SemiBold',sans-serif] text-[11px] tracking-[.1em]"
                  style={{ color: project.color }}
                >
                  {project.number}
                </span>
              </div>

              {/* Main content */}
              <div className="flex flex-col gap-4">
                <div>
                  <p
                    className="mb-1 font-['IBM_Plex_Mono:SemiBold',sans-serif] text-[10px] tracking-[.15em]"
                    style={{ color: project.color }}
                  >
                    {project.discipline}
                  </p>
                  <h3 className="font-['Archivo:ExtraBold',sans-serif] text-[clamp(1.8rem,4vw,3.2rem)] leading-none tracking-[-.065em]">
                    {project.title}
                  </h3>
                </div>

                <p className="max-w-[600px] font-['Archivo:Regular',sans-serif] text-[clamp(0.95rem,1.5vw,1.1rem)] leading-relaxed text-[#121212]/80">
                  {project.description}
                </p>

                <dl className="grid gap-4 sm:grid-cols-2">{project.caseStudy.map(item => <div key={item.label}><dt className="text-sm font-bold mb-1">{item.label}</dt><dd className="text-sm leading-relaxed text-[#121212]/80">{item.text}</dd></div>)}</dl>
                {/* Tool badges */}
                <div className="flex flex-wrap gap-2">
                  {tools.map((t) => (
                    <span
                      key={t.label}
                      className="flex items-center gap-1.5 border border-[#121212]/20 px-2.5 py-1 font-['IBM_Plex_Mono:Regular',sans-serif] text-[9px] tracking-[.1em] text-[#121212]/60"
                    >
                      <span className="shrink-0">{t.icon}</span>
                      {t.label.split(" — ")[0].toUpperCase()}
                    </span>
                  ))}
                </div>

                {project.href ? (
                  <a
                    href={project.href}
                    className="group inline-flex w-fit items-center gap-3 border border-[#121212] px-4 py-2.5 font-['IBM_Plex_Mono:SemiBold',sans-serif] text-[10px] tracking-[.12em] transition-colors hover:bg-[#121212] hover:text-[#f4efe6]"
                  >
                    OPEN LIVE DEMO
                    <IconArrow className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                  </a>
                ) : null}

              </div>
            </div>

            {/* Screenshot panel — non-interactive display */}
            {project.screenshot ? (
              <figure className="mt-7 w-full overflow-hidden border border-[#121212]/20 bg-[#121212]" style={project.wrapperStyle}>
                <img
                  src={project.screenshot}
                  alt={project.screenshotAlt}
                  className="w-full"
                  style={{ display: "block", ...project.imgStyle }}
                  draggable={false}
                />
              </figure>
            ) : null}
          </article>
        ))}
      </div>

      {/* CTA contact */}
      <div className="mt-12 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between border-t border-[#121212] pt-6">
        <p className="font-['IBM_Plex_Mono:Regular',sans-serif] text-[10px] leading-relaxed tracking-[.08em] text-[#121212]/55">
          HAVE AN IDEA? LET'S TALK ABOUT BUILDING IT TOGETHER.
        </p>
        <a
          href={`mailto:${EMAIL}`}
          className="group flex items-center gap-3 bg-[#ff4b1f] px-5 py-3 font-['IBM_Plex_Mono:SemiBold',sans-serif] text-[11px] tracking-[.12em] text-white transition-transform hover:-translate-y-0.5"
        >
          GET IN TOUCH
          <IconArrow className="w-4 h-4 transition-transform group-hover:translate-x-1" />
        </a>
      </div>
    </section>
  );
}

// ── Platform SVG logos ─────────────────────────────────────────────────────

function LogoInstagram({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/>
    </svg>
  );
}

function LogoTwitch({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/>
    </svg>
  );
}

function LogoYouTube({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
    </svg>
  );
}

// ── Page: Contact ──────────────────────────────────────────────────────────

type SocialEntry = {
  platform: string;
  handle: string;
  description: string;
  url: string;
  logo: React.ReactNode;
};

const socialEntries: SocialEntry[] = [
  {
    platform: "Instagram",
    handle: "@miura.enters.thevoid",
    description: "I talk about video games — one of my biggest passions.",
    url: "https://www.instagram.com/miura.enters.thevoid/",
    logo: <LogoInstagram className="w-5 h-5 shrink-0" />,
  },
  {
    platform: "Twitch",
    handle: "@miuratwitch",
    description: "My streaming channel, where I regularly explore the latest in gaming and host BitJungle, my podcast.",
    url: "https://www.twitch.tv/miuratwitch",
    logo: <LogoTwitch className="w-5 h-5 shrink-0" />,
  },
  {
    platform: "YouTube",
    handle: "@MiuraTubo",
    description: "A companion to my Twitch channel, featuring past stream VODs and dedicated gaming projects.",
    url: "https://www.youtube.com/@MiuraTubo",
    logo: <LogoYouTube className="w-5 h-5 shrink-0" />,
  },
];

function PageContact() {
  return (
    <section className="mx-auto max-w-[1240px] px-5 py-10 md:px-8 md:py-14">
      {/* Header */}
      <div className="mb-10 border-b border-[#121212] pb-5">
        <h2 className="font-['Archivo:ExtraBold',sans-serif] text-[clamp(2.4rem,6vw,5rem)] leading-none tracking-[-.07em]">
          SOCIAL &amp; CONTACT
        </h2>
        <p className="mt-2 font-['IBM_Plex_Mono:SemiBold',sans-serif] text-[10px] tracking-[.15em] text-[#ff4b1f]">
          PIACENZA, ITALY — AVAILABLE REMOTELY
        </p>
      </div>

      {/* ── Preface ── */}
      <div className="mb-12 grid gap-8 lg:grid-cols-[1fr_280px] lg:gap-12 xl:grid-cols-[1fr_320px]">
        <div className="flex flex-col justify-center gap-5">
          <h3 className="font-['Archivo:ExtraBold',sans-serif] text-[clamp(1.8rem,4vw,3rem)] leading-none tracking-[-.06em] text-[#121212]">
            so here I am
          </h3>
          <p className="font-['Archivo:Regular',sans-serif] text-[clamp(1rem,1.5vw,1.15rem)] leading-relaxed text-[#121212]/80">
            My work connects design, software development and product decisions. I bring 14 years of practice and hands-on technical ownership, including three years as Front-end Lead at Jobrapido.
          </p>
          <p className="font-['Archivo:Regular',sans-serif] text-[clamp(1rem,1.5vw,1.15rem)] leading-relaxed text-[#121212]/80">
            I use AI integration to build usable tools, with clear limits and reviewable outputs. My independent projects make these choices tangible: try the demos and inspect the trade-offs below.
          </p>
          <p className="font-['Archivo:Regular',sans-serif] text-[clamp(1rem,1.5vw,1.15rem)] leading-relaxed text-[#121212]/80">
            I am looking for opportunities in technical leadership, senior software development, AI applications and AI design, with Italy as my first preference and Europe as my wider search area.
          </p>
        </div>

        <div className="hidden lg:block overflow-hidden rounded-sm" style={{ minHeight: 320 }}>
          <img
            src={imgContactPhoto}
            alt="Francesco Saccullo at the microphone"
            className="h-full w-full object-cover"
            style={{ objectPosition: "center 20%" }}
            draggable={false}
          />
        </div>
      </div>

      <div className="grid gap-10 lg:grid-cols-2">
        {/* Left: email + collaborations */}
        <div className="flex flex-col gap-6">
          <div>
            <p className="mb-3 font-['IBM_Plex_Mono:SemiBold',sans-serif] text-[10px] tracking-[.18em] text-[#ff4b1f]">EMAIL</p>
            <a
              href={`mailto:${EMAIL}`}
              aria-label={`Send email to ${EMAIL}`}
              className="group flex items-center gap-4 border border-[#121212] bg-[#121212] px-5 py-4 text-[#f4efe6] transition-colors hover:bg-[#ff4b1f] hover:border-[#ff4b1f]"
            >
              <IconMail className="w-5 h-5 shrink-0" />
              <span className="font-['IBM_Plex_Mono:SemiBold',sans-serif] text-[12px] tracking-[.05em] break-all">
                {EMAIL}
              </span>
            </a>
          </div>

          <div>
            <p className="mb-3 font-['IBM_Plex_Mono:SemiBold',sans-serif] text-[10px] tracking-[.18em] text-[#ff4b1f]">PHONE</p>
            <a
              href="tel:+393701130993"
              aria-label="Call Francesco at +39 370 113 0993"
              className="group flex items-center gap-4 border border-[#121212] bg-[#121212] px-5 py-4 text-[#f4efe6] transition-colors hover:bg-[#ff4b1f] hover:border-[#ff4b1f]"
            >
              <IconPhone className="w-5 h-5 shrink-0" />
              <span className="font-['IBM_Plex_Mono:SemiBold',sans-serif] text-[12px] tracking-[.05em]">
                +39 370 113 0993
              </span>
            </a>
          </div>

          <div>
            <p className="mb-1 font-['IBM_Plex_Mono:SemiBold',sans-serif] text-[10px] tracking-[.18em] text-[#121212]/50">COLLABORATIONS</p>
            <p className="font-['Archivo:Regular',sans-serif] text-[15px] leading-relaxed text-[#121212]/80">
              Open to all kinds of collaborations. Have an idea? Send it my way!
            </p>
          </div>
        </div>

        {/* Right: social entries */}
        <div>
          <p className="mb-4 font-['IBM_Plex_Mono:SemiBold',sans-serif] text-[10px] tracking-[.18em] text-[#ff4b1f]">SOCIAL</p>
          <div className="flex flex-col gap-3">
            {socialEntries.map((entry) => (
              <a
                key={entry.platform}
                href={entry.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${entry.platform} — ${entry.handle}`}
                className="group flex items-start gap-4 border border-[#121212]/15 bg-[#f4efe6] px-4 py-4 transition-colors hover:border-[#ff4b1f] hover:bg-white"
              >
                {/* Logo */}
                <span className="mt-0.5 text-[#121212]/60 transition-colors group-hover:text-[#ff4b1f]">
                  {entry.logo}
                </span>

                {/* Text */}
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="font-['IBM_Plex_Mono:SemiBold',sans-serif] text-[11px] tracking-[.1em]">
                      {entry.platform.toUpperCase()}
                    </span>
                    <span className="font-['IBM_Plex_Mono:Regular',sans-serif] text-[10px] tracking-[.05em] text-[#121212]/55">
                      {entry.handle}
                    </span>
                  </div>
                  <p className="font-['Archivo:Regular',sans-serif] text-[13px] leading-snug text-[#121212]/70">
                    {entry.description}
                  </p>
                </div>

                {/* Arrow */}
                <span className="ml-auto mt-0.5 shrink-0 text-[#121212]/25 transition-colors group-hover:text-[#ff4b1f]">
                  <IconArrow className="w-4 h-4" />
                </span>
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* Location strip */}
      <div className="mt-12 border-t border-[#121212] pt-6 flex flex-wrap items-center justify-between gap-4">
        <p className="font-['IBM_Plex_Mono:Regular',sans-serif] text-[10px] tracking-[.12em] text-[#121212]/40">
          BASED IN PIACENZA, IT — OPEN TO REMOTE &amp; HYBRID
        </p>
        <p className="font-['IBM_Plex_Mono:Regular',sans-serif] text-[10px] tracking-[.12em] text-[#121212]/40">
          MEDIAKIT — 2026
        </p>
      </div>
    </section>
  );
}
