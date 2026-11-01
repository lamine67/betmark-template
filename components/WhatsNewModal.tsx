"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { releasesForHost, formatReleaseDate } from "../lib/whatsNew";
import WhatsNewView from "./WhatsNewView";

export default function WhatsNewModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  const [isCrypto, setIsCrypto] = useState(false);

  useEffect(() => {
    setMounted(true);
    const h = window.location.hostname.toLowerCase();
    setIsCrypto(h.startsWith("crypto.") || h.startsWith("krypto."));
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // страница под окном не прокручивается
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  const releases = useMemo(
    () =>
      releasesForHost(isCrypto).map((r) => ({
        version: r.version,
        title: r.title,
        dateLabel: formatReleaseDate(r.date),
        added: r.added.map(({ tag, text }) => ({ tag, text })),
        improved: r.improved.map(({ tag, text }) => ({ tag, text })),
      })),
    [isCrypto],
  );

  if (!mounted || !open) return null;
  return createPortal(
    <div className="wn-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} role="dialog" aria-modal="true" aria-label="Журнал обновлений">
      <WhatsNewView releases={releases} onClose={onClose} />
    </div>,
    document.body,
  );
}
