"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Tab = { href: string; label: string; adminOnly?: boolean };

const TABS: Tab[] = [
  { href: "/dashboard", label: "Overview" },
  { href: "/map", label: "Map" },
  { href: "/properties", label: "Properties" },
  { href: "/triage", label: "Triage" },
  { href: "/dupes", label: "Dupes", adminOnly: true },
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

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link href="/dashboard" className="topbar-brand">
          <span className="topbar-brand-mark" aria-hidden>D</span>
          <span className="topbar-brand-text">
            <span className="topbar-brand-name">Dream Knysna</span>
            <span className="topbar-brand-sub">Properties OS</span>
          </span>
        </Link>

        <nav className="topbar-nav" aria-label="Primary">
          {TABS.filter((t) => !t.adminOnly || isAdmin).map((t) => {
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
    </header>
  );
}
