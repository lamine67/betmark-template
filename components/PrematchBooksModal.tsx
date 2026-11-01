"use client";

import { useEffect, useState } from "react";
import Loader from "./Loader";
import { useParsedBooks } from "@/lib/useParsedBooks";
import { PREMATCH_BOOK_ORDER, prematchBookName } from "@/lib/prematchBooks";
import { CRYPTO_LIVE_ADAPTER_SLUGS } from "@/lib/liveAdapters";

const CRYPTO = new Set<string>([...(CRYPTO_LIVE_ADAPTER_SLUGS as readonly string[]), "bookn", "bookq"]);

export default function PrematchBooksModal({ onClose, onSaved }: { onClose: () => void; onSaved: (count: number | null) => void }) {
  const isParsed = useParsedBooks();
  const ALL = PREMATCH_BOOK_ORDER.filter(isParsed);
  const regular = ALL.filter((s) => !CRYPTO.has(s));
  const crypto = ALL.filter((s) => CRYPTO.has(s));
  const [sel, setSel] = useState<Set<string>>(new Set(ALL));
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/report-books?kind=prematch")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j) => {
        const b: string[] = Array.isArray(j?.books) ? j.books : [];
        setSel(new Set(b.length > 0 ? b : ALL));
      })
      .catch(() => setErr("Не удалось загрузить ваш набор контор."))
      .finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (slug: string) =>
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) {
        if (next.size > 1) next.delete(slug); // хотя бы одна контора должна остаться
      } else next.add(slug);
      return next;
    });

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const allOn = ALL.every((x) => sel.has(x));
      const res = await fetch("/api/report-books", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "prematch", books: allOn ? [] : ALL.filter((x) => sel.has(x)) }),
      });
      if (!res.ok) {
        setErr("Не удалось сохранить.");
        return;
      }
      onSaved(allOn ? null : sel.size);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const chip = (slug: string) => {
    const on = sel.has(slug);
    return (
      <button key={slug} type="button" className={`live-bookmaker-chip${on ? " live-bookmaker-chip-on" : ""}`} onClick={() => toggle(slug)}>
        <span className="msi live-bookmaker-chip-icon">{on ? "check_circle" : "radio_button_unchecked"}</span>
        {prematchBookName(slug)}
      </button>
    );
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box report-picker" role="dialog" aria-modal="true" aria-label="Конторы в прематч-отчётах" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Конторы в прематч-отчётах</span>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Закрыть">
            <span className="msi">close</span>
          </button>
        </div>
        <div className="report-picker-body">
          {!loaded ? (
            <Loader label="Загрузка…" size={63} />
          ) : (
            <>
              <div className="report-picker-presets">
                <button type="button" className="st-link-btn" onClick={() => setSel(new Set(ALL))}>Все</button>
                <button type="button" className="st-link-btn" onClick={() => setSel(new Set(regular))}>Только обычные</button>
                <button type="button" className="st-link-btn" onClick={() => setSel(new Set(crypto))}>Только крипто</button>
              </div>
              <div className="report-picker-group">
                <div className="report-picker-group-title">Обычные конторы</div>
                <div className="report-picker-chips">{regular.map(chip)}</div>
              </div>
              <div className="report-picker-group">
                <div className="report-picker-group-title">Крипто-конторы</div>
                <div className="report-picker-chips">{crypto.map(chip)}</div>
              </div>
              <div className="report-picker-note">
                Набор личный и отдельный от live-отчётов: он применяется ко всем прематч-отчётам, которые скачиваете вы. Если у матча нет данных от выбранной конторы, её колонка в отчёте будет с прочерками.
              </div>
              {err && <div className="live-error" style={{ marginTop: 10 }}>{err}</div>}
            </>
          )}
        </div>
        <div className="report-picker-actions">
          <button type="button" className="logs-button" disabled={!loaded || busy} onClick={save}>
            <span className="msi">check</span>
            Сохранить · {sel.size} из {ALL.length}
          </button>
          <button type="button" className="logs-button" onClick={onClose}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}
