"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// Nav model:
//  - Leaf = direct link (Overview, Inbox)
//  - Group = dropdown that opens to a list of child links
// Both leaves and groups can be admin-gated. A group is admin-gated when
// EVERY child is admin-only OR the group itself is marked adminOnly; children
// filter individually so an agent looking at a partially-gated group only
// sees the child links they're allowed.

type Leaf = { kind: "leaf"; href: string; label: string; adminOnly?: boolean };
type Group = { kind: "group"; label: string; adminOnly?: boolean; children: Leaf[] };
type NavItem = Leaf | Group;

const NAV: NavItem[] = [
  { kind: "leaf", href: "/dashboard", label: "Overview" },
  { kind: "leaf", href: "/inbox", label: "Inbox" },
  {
    kind: "group",
    label: "Records",
    children: [
      { kind: "leaf", href: "/properties", label: "Properties" },
      { kind: "leaf", href: "/map", label: "Map" },
      { kind: "leaf", href: "/contacts", label: "Contacts" },
      { kind: "leaf", href: "/erf-lookup", label: "Erf Lookup" },
      { kind: "leaf", href: "/estates", label: "Estates" },
    ],
  },
  {
    kind: "group",
    label: "Deals",
    children: [
      { kind: "leaf", href: "/mandates", label: "Mandates" },
      { kind: "leaf", href: "/pipeline", label: "Pipeline" },
      { kind: "leaf", href: "/viewings", label: "Viewings" },
      { kind: "leaf", href: "/compliance", label: "Compliance", adminOnly: true },
    ],
  },
  {
    kind: "group",
    label: "Admin",
    adminOnly: true,
    children: [
      { kind: "leaf", href: "/triage", label: "Triage" },
      { kind: "leaf", href: "/dupes", label: "Dupes" },
      { kind: "leaf", href: "/team", label: "Team" },
      { kind: "leaf", href: "/settings", label: "Settings" },
    ],
  },
];

function isActiveHref(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

function visibleChildren(g: Group, isAdmin: boolean): Leaf[] {
  return g.children.filter((c) => !c.adminOnly || isAdmin);
}

function visibleNav(isAdmin: boolean): NavItem[] {
  const out: NavItem[] = [];
  for (const item of NAV) {
    if (item.kind === "leaf") {
      if (!item.adminOnly || isAdmin) out.push(item);
      continue;
    }
    if (item.adminOnly && !isAdmin) continue;
    const kids = visibleChildren(item, isAdmin);
    if (kids.length === 0) continue;
    out.push({ ...item, children: kids });
  }
  return out;
}

export default function TopBarClient({
  name,
  role,
}: {
  name: string;
  role: string;
}) {
  const path = usePathname();
  const isAdmin = role === "admin";
  const items = visibleNav(isAdmin);

  // Drawer state (mobile only — CSS hides the desktop nav below 900px and
  // shows the hamburger drawer instead).
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => setDrawerOpen(false), [path]);

  // Open dropdown group name, or null when nothing's open. One at a time —
  // clicking a different group closes the previous one.
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  useEffect(() => setOpenGroup(null), [path]);

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
          {items.map((item) => {
            if (item.kind === "leaf") {
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
            }
            return (
              <TopBarGroup
                key={item.label}
                group={item}
                path={path}
                openLabel={openGroup}
                onOpen={(name) =>
                  setOpenGroup((current) => (current === name ? null : name))
                }
                onClose={() => setOpenGroup(null)}
              />
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

      {/* Mobile drawer — flat list with small section headers between groups.
          Nested dropdowns are wrong on mobile; the tap surface is small enough
          that the flat list stays legible. */}
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
          {items.map((item) => {
            if (item.kind === "leaf") {
              const active = isActiveHref(path, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={
                    active
                      ? "topbar-drawer-tab topbar-drawer-tab-on"
                      : "topbar-drawer-tab"
                  }
                  aria-current={active ? "page" : undefined}
                  onClick={() => setDrawerOpen(false)}
                >
                  {item.label}
                </Link>
              );
            }
            return (
              <div key={item.label}>
                <div className="topbar-drawer-section">{item.label}</div>
                {item.children.map((c) => {
                  const active = isActiveHref(path, c.href);
                  return (
                    <Link
                      key={c.href}
                      href={c.href}
                      className={
                        active
                          ? "topbar-drawer-tab topbar-drawer-tab-on"
                          : "topbar-drawer-tab"
                      }
                      aria-current={active ? "page" : undefined}
                      onClick={() => setDrawerOpen(false)}
                    >
                      {c.label}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

function TopBarGroup({
  group,
  path,
  openLabel,
  onOpen,
  onClose,
}: {
  group: Group;
  path: string;
  openLabel: string | null;
  onOpen: (label: string) => void;
  onClose: () => void;
}) {
  const isOpen = openLabel === group.label;
  const hasActiveChild = group.children.some((c) => isActiveHref(path, c.href));
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Click outside + Escape both close the dropdown so it never lingers.
  useEffect(() => {
    if (!isOpen) return;
    function onMouseDown(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) onClose();
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
  }, [isOpen, onClose]);

  return (
    <div ref={wrapperRef} className="topbar-group">
      <button
        type="button"
        className={
          hasActiveChild || isOpen
            ? "topbar-tab topbar-tab-on topbar-group-btn"
            : "topbar-tab topbar-group-btn"
        }
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => onOpen(group.label)}
      >
        {group.label}
        <span aria-hidden className="topbar-group-chevron">▾</span>
      </button>
      {isOpen && (
        <div role="menu" className="topbar-group-menu">
          {group.children.map((c) => {
            const active = isActiveHref(path, c.href);
            return (
              <Link
                key={c.href}
                role="menuitem"
                href={c.href}
                className={
                  active
                    ? "topbar-group-item topbar-group-item-on"
                    : "topbar-group-item"
                }
                onClick={onClose}
              >
                {c.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
