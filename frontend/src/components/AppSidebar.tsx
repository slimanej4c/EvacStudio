"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FilePlus2, Files, Gauge, LogOut, Menu, ShieldCheck, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

type NavItem = {
  label: string;
  href: string;
  icon: typeof Gauge;
  activePattern?: RegExp;
};

const planItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: Gauge, activePattern: /^\/dashboard$/ },
  { label: "Mes plans", href: "/evacuation-plans", icon: Files, activePattern: /^\/evacuation-plans$/ },
  { label: "Nouveau plan", href: "/evacuation-plans/new", icon: FilePlus2, activePattern: /^\/evacuation-plans\/new$/ },
];

function initialSidebarHiddenState() {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem("appSidebar.hidden") === "true";
}

function SidebarLink({ item }: { item: NavItem }) {
  const pathname = usePathname();
  const active = item.activePattern ? item.activePattern.test(pathname) : pathname === item.href;
  const Icon = item.icon;

  const handleClick = () => {
    if (active && item.href === "/evacuation-plans") {
      window.dispatchEvent(new Event("evacuation-plans:refresh"));
    }
  };

  return (
    <Link
      href={item.href}
      onClick={handleClick}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? "bg-safety-green text-white shadow-sm shadow-safety-green/10"
          : "text-slate-600 hover:bg-green-50 hover:text-safety-green"
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
    </Link>
  );
}

export function AppSidebar() {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const navRef = useRef<HTMLElement | null>(null);
  const displayName = [user?.first_name, user?.last_name].filter(Boolean).join(" ") || user?.username;
  const [sidebarHidden, setSidebarHidden] = useState(initialSidebarHiddenState);

  useEffect(() => {
    sessionStorage.setItem("appSidebar.hidden", sidebarHidden ? "true" : "false");
  }, [sidebarHidden]);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const savedScroll = Number(sessionStorage.getItem("appSidebar.scrollTop") || "0");
    if (Number.isFinite(savedScroll)) nav.scrollTop = savedScroll;
    const saveScroll = () => sessionStorage.setItem("appSidebar.scrollTop", String(nav.scrollTop));
    nav.addEventListener("scroll", saveScroll, { passive: true });
    return () => nav.removeEventListener("scroll", saveScroll);
  }, [pathname]);

  if (sidebarHidden) {
    return (
      <button
        type="button"
        onClick={() => setSidebarHidden(false)}
        className="fixed left-4 top-4 z-50 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-green-200 bg-white text-safety-green shadow-lg transition-colors hover:bg-green-50"
        title="Afficher le menu"
        aria-label="Afficher le menu"
      >
        <Menu className="h-5 w-5" />
      </button>
    );
  }

  return (
    <aside className="sticky left-0 top-0 flex h-screen w-72 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="flex h-16 items-center justify-between gap-3 border-b border-slate-200 px-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-40 shrink-0 items-center overflow-hidden rounded-lg">
            <img src="/evacstudio-logo.png" alt="EvacStudio" className="h-full w-full object-contain" />
          </div>
          <div className="min-w-0 hidden">
            <p className="truncate text-base font-bold leading-tight text-slate-950">Plan intervention et évacuation</p>
            <p className="truncate text-xs text-slate-500">Sécurité incendie</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setSidebarHidden(true)}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-green-50 hover:text-safety-green"
          title="Masquer le menu"
          aria-label="Masquer le menu"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <nav ref={navRef} className="flex-1 space-y-2 overflow-y-auto px-4 py-5">
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-green-100 bg-green-50 px-3 py-2 text-[11px] font-extrabold uppercase tracking-normal text-safety-green">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
          <span>Plans d&apos;intervention et d&apos;évacuation</span>
        </div>
        {planItems.map((item) => (
          <SidebarLink key={item.href} item={item} />
        ))}
      </nav>

      <div className="border-t border-slate-200 p-4">
        <div className="mb-3 rounded-lg bg-slate-50 px-3 py-2">
          <p className="truncate text-sm font-semibold text-slate-950">{displayName}</p>
          <p className="truncate text-xs text-slate-500">{user?.email || "Utilisateur connecté"}</p>
        </div>
        <button
          onClick={logout}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-safety-green transition-colors hover:bg-green-100"
        >
          <LogOut className="h-4 w-4" />
          Déconnexion
        </button>
      </div>
    </aside>
  );
}
