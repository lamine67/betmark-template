"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Logo from "./Logo";
import WhatsNewModal from "./WhatsNewModal";

// Единая шапка всех страниц инструмента (доска, Live-трекер, Статус, Что нового)
const NAV = [
  { href: "/board", label: "Линия", icon: "table_rows" },
  { href: "/live", label: "Live-трекер", icon: "sensors" },
  { href: "/reports", label: "Отчёты", icon: "picture_as_pdf" },
];
// «Что нового» открывается окном поверх текущей страницы (не переходом): см
const WHATS_NEW = { label: "Что нового", icon: "new_releases" };

export default function SiteHeader({ center }: { center?: React.ReactNode }) {
  const pathname = usePathname() || "";
  const [open, setOpen] = useState(false);
  const [whatsOpen, setWhatsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="sh-inner">
      <WhatsNewModal open={whatsOpen} onClose={() => setWhatsOpen(false)} />
      <Link className="sh-brand" href="/board" aria-label="Betmark — перейти к линии">
        <Logo />
      </Link>
      <nav className="sh-nav" aria-label="Разделы">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={`sh-link${isActive(n.href) ? " sh-link-on" : ""}`} aria-current={isActive(n.href) ? "page" : undefined}>
            {n.label}
          </Link>
        ))}
      </nav>
      <div className="sh-spacer" />
      <button type="button" className="sh-gear sh-whats" aria-label={WHATS_NEW.label} title={WHATS_NEW.label} onClick={() => setWhatsOpen(true)}>
        <span className="msi">{WHATS_NEW.icon}</span>
      </button>
      <Link href="/status" className={`sh-gear${isActive("/status") ? " sh-gear-on" : ""}`} aria-label="Настройки" title="Настройки" aria-current={isActive("/status") ? "page" : undefined}>
        <span className="msi">settings</span>
      </Link>
      <form className="sh-logout" action="/api/auth/logout" method="POST">
        <button type="submit" className="sh-link sh-link-btn sh-logout-btn" aria-label="Выйти" title="Выйти">
          <span className="msi">logout</span>
        </button>
      </form>
      <div className="sh-burger" ref={menuRef}>
        <button type="button" className="header-mobile-nav-btn" aria-label="Меню" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <span className="msi">{open ? "close" : "menu"}</span>
        </button>
        {open && (
          <div className="header-mobile-nav-menu">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className={`header-mobile-nav-item${isActive(n.href) ? " sh-mobile-on" : ""}`}>
                <span className="msi">{n.icon}</span>
                {n.label}
              </Link>
            ))}
            <button type="button" className="header-mobile-nav-item header-mobile-nav-item-btn" onClick={() => { setOpen(false); setWhatsOpen(true); }}>
              <span className="msi">{WHATS_NEW.icon}</span>
              {WHATS_NEW.label}
            </button>
            <form action="/api/auth/logout" method="POST">
              <button type="submit" className="header-mobile-nav-item header-mobile-nav-item-btn">
                <span className="msi">logout</span>
                Выйти
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
