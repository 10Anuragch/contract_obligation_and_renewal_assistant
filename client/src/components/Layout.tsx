import { useEffect, useState } from "react";
import { NavLink, Outlet, Link } from "react-router-dom";
import { CalendarClock, FileText, Info, LayoutDashboard, Menu, Scale, ShieldAlert, Upload, X } from "lucide-react";
import { api } from "../lib/api";
import { DISCLAIMER } from "./ui";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/contracts", label: "Contracts", icon: FileText },
  { to: "/upcoming", label: "Upcoming", icon: CalendarClock },
  { to: "/about", label: "Settings / About", icon: Info },
];

export default function Layout() {
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState<any>(null);
  useEffect(() => {
    api.get("/api/health").then(setHealth).catch(() => setHealth({ ok: false }));
  }, []);

  const sidebar = (
    <nav className="flex h-full flex-col bg-slate-900 text-slate-300">
      <Link to="/" className="flex items-center gap-2 px-5 py-5 text-white" onClick={() => setOpen(false)}>
        <Scale size={22} className="text-brand-100" />
        <div className="leading-tight">
          <div className="text-sm font-semibold">Contract Assistant</div>
          <div className="text-[11px] text-slate-400">Obligations & renewals</div>
        </div>
      </Link>
      <div className="flex-1 space-y-1 px-3">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${isActive ? "bg-slate-800 text-white" : "hover:bg-slate-800/60 hover:text-white"}`
            }
          >
            <Icon size={17} /> {label}
          </NavLink>
        ))}
      </div>
      <div className="m-3 rounded-lg bg-slate-800 p-3 text-[11px] leading-snug text-slate-400">
        <div className="mb-1 flex items-center gap-1 font-semibold text-slate-200">
          <ShieldAlert size={13} /> Not legal advice
        </div>
        Information-management and review tool. Always check extracted items against the source document.
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-full">
      <aside className="fixed inset-y-0 left-0 hidden w-60 lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-60">{sidebar}</aside>
        </div>
      )}

      <div className="flex min-h-full flex-1 flex-col lg:pl-60">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur sm:px-6">
          <button className="btn-ghost !p-1.5 lg:hidden" onClick={() => setOpen((o) => !o)} aria-label="Toggle navigation">
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div className="hidden min-w-0 flex-1 truncate text-xs text-slate-500 sm:block" title={DISCLAIMER}>
            <ShieldAlert size={13} className="mr-1 inline text-amber-600" />
            {DISCLAIMER}
          </div>
          <div className="flex-1 sm:hidden" />
          {health && health.ok && !health.ai?.configured && (
            <span className="hidden rounded-full bg-amber-50 px-2.5 py-1 text-xs text-amber-800 ring-1 ring-amber-200 md:inline">AI not configured</span>
          )}
          {health?.ai?.provider === "demo" && (
            <span className="hidden rounded-full bg-violet-50 px-2.5 py-1 text-xs text-violet-700 ring-1 ring-violet-200 md:inline">Demo extractor (offline)</span>
          )}
          <Link to="/upload" className="btn-primary">
            <Upload size={15} /> Upload Contract
          </Link>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
          <Outlet />
        </main>
        <footer className="border-t border-slate-200 px-6 py-3 text-center text-[11px] text-slate-400 sm:hidden">{DISCLAIMER}</footer>
      </div>
    </div>
  );
}
