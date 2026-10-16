"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Light } from "@/lib/feeds/registry";
import CommandSearch from "./CommandSearch";

// Top bar — Blueprint (plan 019 Arc D, 2026-10-16).
//
// Flat row of the places an agent actually goes, in the order of the day:
// Home, Map, Properties, Deals, Documents, People, Inbox. Two small menus
// hold the rest: More (the tools), Admin (admin-only, carrying the data-
// health dot so Bronwyn sees a feed problem from any page). Search (⌘K)
// sits by the avatar, which opens account + sign out. Under 768px the row
// folds into the drawer; search stays in the bar as an icon.

type Leaf = { href: string; label: string; adminOnly?: boolean };
type Group = { label: string; adminOnly?: boolean; children: Leaf[]; alignRight?: boolean };

const PRIMARY: Leaf[] = [
  { href: "/dashboard", label: "Home" },
  { href: "/map", label: "Map" },
  { href: "/properties", label: "Properties" },
  { href: "/pipeline", label: "Deals" },
  { href: "/documents", label: "Documents" },
  { href: "/contacts", label: "People" },
  { href: "/inbox", label: "Inbox" },
];

const MORE: Group = {
  label: "More",
  children: [
    { href: "/mandates", label: "Mandates" },
    { href: "/viewings", label: "Viewings" },
    { href: "/estates", label: "Estates" },
    { href: "/erf-lookup", label: "Erf lookup" },
  ],
};

const ADMIN: Group = {
  label: "Admin",
  adminOnly: true,
  children: [
    { href: "/admin/health", label: "Data health" },
    { href: "/compliance", label: "Compliance" },
    { href: "/triage", label: "Triage" },
    { href: "/dupes", label: "Dupes" },
    { href: "/team", label: "Team" },
    { href: "/settings", label: "Settings" },
  ],
};

function isActiveHref(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard" || pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function TopBarClient({
  name,
  role,
  healthLight,
}: {
  name: string;
  role: string;
  healthLight: Light | null;
}) {
  const path = usePathname();
  const isAdmin = role === "admin";
  const groups: Group[] = isAdmin ? [MORE, ADMIN] : [MORE];

  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => setDrawerOpen(false), [path]);

  // One open menu at a time: a group label, "who", or null.
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  useEffect(() => setOpenMenu(null), [path]);

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

        <Link href="/dashboard" className="topbar-brand" aria-label="Dream Knysna OS — home">
          <span className="topbar-brand-text">
            <span className="topbar-brand-name">Dream</span>
            <span className="topbar-brand-sub">Knysna OS</span>
          </span>
        </Link>

        <nav className="topbar-nav" aria-label="Primary">
          {PRIMARY.map((item) => {
            const active = isActiveHref(path, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? "topbar-tab topbar-tab-on" : "topbar-tab"}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
          {groups.map((g) => (
            <Menu
              key={g.label}
              id={g.label}
              open={openMenu === g.label}
              onToggle={() => setOpenMenu((c) => (c === g.label ? null : g.label))}
              onClose={() => setOpenMenu(null)}
              button={
                <>
                  {g.label === "Admin" && healthLight && (
                    <span className={`topbar-dot topbar-dot-${healthLight}`} aria-hidden />
                  )}
                  {g.label}
                  <span aria-hidden className="topbar-group-chevron">▾</span>
                </>
              }
              buttonClass={
                g.children.some((c) => isActiveHref(path, c.href)) || openMenu === g.label
                  ? "topbar-tab topbar-tab-on topbar-group-btn"
                  : "topbar-tab topbar-group-btn"
              }
            >
              {g.children.map((c) => {
                const active = isActiveHref(path, c.href);
                return (
                  <Link
                    key={c.href}
                    role="menuitem"
                    href={c.href}
                    className={active ? "topbar-group-item topbar-group-item-on" : "topbar-group-item"}
                    onClick={() => setOpenMenu(null)}
                  >
                    {c.href === "/admin/health" && healthLight && (
                      <span className={`topbar-dot topbar-dot-${healthLight}`} aria-hidden />
                    )}
                    {c.label}
                  </Link>
                );
              })}
            </Menu>
          ))}
        </nav>

        <div className="topbar-tools">
          <CommandSearch />
          <Menu
            id="who"
            open={openMenu === "who"}
            onToggle={() => setOpenMenu((c) => (c === "who" ? null : "who"))}
            onClose={() => setOpenMenu(null)}
            alignRight
            button={<span aria-hidden>{initials(name)}</span>}
            buttonClass="topbar-avatar"
            buttonLabel={`${name} — account menu`}
          >
            <div className="topbar-who-menu-head">
              <span className="topbar-who-menu-name">{name}</span>
              <span className="topbar-who-menu-role">{role}</span>
            </div>
            <div className="topbar-group-sep" />
            <Link role="menuitem" href="/account/password" className="topbar-group-item" onClick={() => setOpenMenu(null)}>
              Change password
            </Link>
            <form action="/auth/signout" method="post">
              <button className="topbar-signout" type="submit" role="menuitem">
                Sign out
              </button>
            </form>
          </Menu>
        </div>
      </div>

      {/* Mobile drawer — one flat list, section labels between the groups. */}
      <div
        className={`topbar-drawer${drawerOpen ? " on" : ""}`}
        aria-hidden={!drawerOpen}
        onClick={() => setDrawerOpen(false)}
      >
        <nav className="topbar-drawer-nav" aria-label="Primary (mobile)" onClick={(e) => e.stopPropagation()}>
          {PRIMARY.map((item) => (
            <DrawerLink key={item.href} item={item} path={path} onPick={() => setDrawerOpen(false)} />
          ))}
          {groups.map((g) => (
            <div key={g.label}>
              <div className="topbar-drawer-section">{g.label}</div>
              {g.children.map((c) => (
                <DrawerLink key={c.href} item={c} path={path} onPick={() => setDrawerOpen(false)} dot={c.href === "/admin/health" ? healthLight : null} />
              ))}
            </div>
          ))}
          <div>
            <div className="topbar-drawer-section">{name}</div>
            <DrawerLink item={{ href: "/account/password", label: "Change password" }} path={path} onPick={() => setDrawerOpen(false)} />
            <form action="/auth/signout" method="post">
              <button className="topbar-signout-drawer topbar-drawer-tab" type="submit">
                Sign out
              </button>
            </form>
          </div>
        </nav>
      </div>
    </header>
  );
}

function DrawerLink({ item, path, onPick, dot }: { item: Leaf; path: string; onPick: () => void; dot?: Light | null }) {
  const active = isActiveHref(path, item.href);
  return (
    <Link
      href={item.href}
      className={active ? "topbar-drawer-tab topbar-drawer-tab-on" : "topbar-drawer-tab"}
      aria-current={active ? "page" : undefined}
      onClick={onPick}
    >
      {dot && <span className={`topbar-dot topbar-dot-${dot}`} style={{ marginRight: 8 }} aria-hidden />}
      {item.label}
    </Link>
  );
}

/** A button that opens a small menu; click-outside and Escape close it. */
function Menu({
  id,
  open,
  onToggle,
  onClose,
  button,
  buttonClass,
  buttonLabel,
  alignRight,
  children,
}: {
  id: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  button: ReactNode;
  buttonClass: string;
  buttonLabel?: string;
  alignRight?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <div ref={ref} className="topbar-group">
      <button
        type="button"
        className={buttonClass}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={`menu-${id}`}
        aria-label={buttonLabel}
        onClick={onToggle}
      >
        {button}
      </button>
      {open && (
        <div id={`menu-${id}`} role="menu" className={alignRight ? "topbar-group-menu is-right" : "topbar-group-menu"}>
          {children}
        </div>
      )}
    </div>
  );
}
