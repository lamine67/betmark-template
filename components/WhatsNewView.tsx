"use client";

import { useEffect, useState } from "react";

export interface WnItem {
  tag: string;
  text: string;
}

export interface WnRelease {
  version: string;
  title: string;
  dateLabel: string;
  added: WnItem[];
  improved: WnItem[];
}

function Items({ title, items }: { title: string; items: WnItem[] }) {
  if (items.length === 0) return null;
  return (
    <>
      <h3 className="wn-kind">{title}</h3>
      <ul className="wn-list">
        {items.map((it, i) => (
          <li key={i}>
            <strong>[{it.tag}]</strong> {it.text}
          </li>
        ))}
      </ul>
    </>
  );
}

// «Журнал обновлений» слева версии по дням (карточки с бейджем «Новый», названием и датой), справа
export default function WhatsNewView({ releases, onClose }: { releases: WnRelease[]; onClose?: () => void }) {
  const modal = !!onClose; // в режиме окна поверх интерфейса: крестик справа сверху, адрес страницы не меняем
  const [selected, setSelected] = useState<string>(releases[0]?.version ?? "");

  useEffect(() => {
    if (modal) return;
    const fromHash = window.location.hash.replace("#", "");
    if (fromHash && releases.some((r) => r.version === fromHash)) setSelected(fromHash);
  }, [releases, modal]);

  const pick = (v: string) => {
    setSelected(v);
    if (modal) return;
    try {
      window.history.replaceState(null, "", `#${v}`);
    } catch {
      /* адресная строка недоступна - выбор всё равно работает */
    }
    if (window.innerWidth <= 800) document.getElementById("wn-detail")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const cur = releases.find((r) => r.version === selected) ?? releases[0];
  if (!cur) return null;
  const total = cur.added.length + cur.improved.length;

  return (
    <div className={`wn-panel${modal ? " wn-panel-modal" : ""}`}>
      <div className="wn-panel-head">
        <span className="msi wn-panel-icon">new_releases</span>
        <div>
          <h1 className="wn-title">Журнал обновлений</h1>
          <div className="wn-sub">Узнайте о новых возможностях Betmark</div>
        </div>
        {onClose && (
          <button type="button" className="wn-close" aria-label="Закрыть" title="Закрыть" onClick={onClose}>
            <span className="msi">close</span>
          </button>
        )}
      </div>
      <div className="wn-body">
        <div className="wn-picker">
          <label className="wn-picker-label" htmlFor="wn-select">Версия</label>
          <select id="wn-select" className="wn-select" value={cur.version} onChange={(e) => pick(e.target.value)}>
            {releases.map((r) => (
              <option key={r.version} value={r.version}>
                {r.version} · {r.title}
              </option>
            ))}
          </select>
        </div>
        <nav className="wn-side" aria-label="Версии">
          {releases.map((r, idx) => {
            const n = r.added.length + r.improved.length;
            return (
              <button
                key={r.version}
                type="button"
                className={`wn-card${r.version === cur.version ? " wn-card-active" : ""}`}
                onClick={() => pick(r.version)}
              >
                {idx === 0 && <span className="wn-new">Новый</span>}
                <span className="wn-card-title">{r.title}</span>
                <span className="wn-card-meta">
                  Версия {r.version} · {r.dateLabel}
                </span>
                <span className="wn-card-count">{n} {n === 1 ? "изменение" : n < 5 ? "изменения" : "изменений"}</span>
              </button>
            );
          })}
        </nav>
        <section className="wn-detail" id="wn-detail" tabIndex={0}>
          <div className="wn-detail-head">
            {cur.version === releases[0].version && <span className="wn-new">Новый</span>}
            <h2 className="wn-detail-title">{cur.title}</h2>
            <div className="wn-detail-meta">
              {cur.dateLabel} · версия {cur.version}
            </div>
          </div>
          <div className="wn-detail-body">
            <h3 className="wn-detail-sub">Что нового в этом обновлении</h3>
            <p className="wn-intro">Это обновление включает следующие изменения ({total}):</p>
            <Items title="Новое" items={cur.added} />
            <Items title="Улучшения" items={cur.improved} />
          </div>
        </section>
      </div>
    </div>
  );
}
