"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type Tab = { href: string; label: string; adminOnly?: boolean };

const TABS: Tab[] = [
  { href: "/dashboard", label: "Overview" },
  { href: "/map", label: "Map" },
  { href: "/properties", label: "Properties" },
  { href: "/triage", label: "Triage" },
  { href: "/dupes", label: "Dupes", adminOnly: true },
  { href: "/team", label: "Team", adminOnly: true },
];

export default function TopBarClient({
  name,
  role,
}: {
  name: string;
  role: string;
}) {
  const path = usePathname();
  const isAdmin = role === "admin";
  const visibleTabs = TABS.filter((t) => !t.adminOnly || isAdmin);

  // Drawer state is mobile-only functionally — on desktop the CSS pins the
  // drawer offscreen and the hamburger button is display: none, so this state
  // does nothing to the rendered UI. That's why we don't gate it behind a
  // matchMedia hook.
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Auto-close the drawer whenever the route changes so a tab tap doesn't
  // leave the overlay hanging.
  useEffect(() => {
    setDrawerOpen(false);
  }, [path]);

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <button
          type="button"
          className="topbar-hamburger"
          aria-label={drawerOpen ? "Close menu" : "Open menu"}
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen((v) => !v)}
        >
          <span className="topbar-hamburger-bar" />
          <span className="topbar-hamburger-bar" />
          <span className="topbar-hamburger-bar" />
        </button>

        <Link href="/dashboard" className="topbar-brand">
          <span className="topbar-brand-mark" aria-hidden>D</span>
          <span className="topbar-brand-text">
            <span className="topbar-brand-name">Dream Knysna</span>
            <span className="topbar-brand-sub">Properties OS</span>
          </span>
        </Link>

        <nav className="topbar-nav" aria-label="Primary">
          {visibleTabs.map((t) => {
            const active = path === t.href || path.startsWith(t.href + "/");
            return (
              <Link
                key={t.href}
                href={t.href}
                className={active ? "topbar-tab topbar-tab-on" : "topbar-tab"}
                aria-current={active ? "page" : undefined}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>

        <div className="topbar-tools">
          <span className="topbar-who">
            <span className="topbar-who-name">{name}</span>
            <span className={`topbar-who-role role-${role}`}>{role}</span>
          </span>
          <form action="/auth/signout" method="post">
            <button className="topbar-signout" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </div>
      <div className="topbar-tideline" aria-hidden />

      {/* Mobile-only slide-down drawer. The scrim closes it when tapped; the
          inner nav catches its own clicks so links still fire. */}
      <div
        className={`topbar-drawer${drawerOpen ? " on" : ""}`}
        aria-hidden={!drawerOpen}
        onClick={() => setDrawerOpen(false)}
      >
        <nav
          className="topbar-drawer-nav"
          aria-label="Primary (mobile)"
          onClick={(e) => e.stopPropagation()}
        >
          {visibleTabs.map((t) => {
            const active = path === t.href || path.startsWith(t.href + "/");
            return (
              <Link
                key={t.href}
                href={t.href}
                className={
                  active
                    ? "topbar-drawer-tab topbar-drawer-tab-on"
                    : "topbar-drawer-tab"
                }
                aria-current={active ? "page" : undefined}
                onClick={() => setDrawerOpen(false)}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
