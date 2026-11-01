"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { isCryptoSlug } from "../../lib/cryptoBooks";
import { useParsedBooks } from "../../lib/useParsedBooks";
import ReportPrepareAsk from "../../components/ReportPrepareAsk";
import { LIVE_ADAPTER_SLUGS, LIVE_ADAPTER_DISPLAY, CRYPTO_LIVE_ADAPTER_SLUGS, CRYPTO_LIVE_ADAPTER_DISPLAY } from "../../lib/liveAdapters";
import Link from "next/link";
import SiteHeader from "../../components/SiteHeader";
import Loader from "../../components/Loader";
import ProxyTable, { type ProxyClient } from "../proxies/ProxyTable";
import LiveStatusTab from "../../components/LiveStatusPanel";
import { useBetmarkPerms } from "../../lib/useBetmarkPerms";
import { getThemePref, setThemePref, getCardsPref, setCardsPref, type ThemePref, type CardsPref } from "../../lib/viewPrefs";
import type { BetmarkPerms } from "../../lib/betmarkPermKeys";

interface ProcessStat {
  running: boolean;
  mode: string | null;
  cpuPercent: number;
  memMb: number;
  procCount: number;
  tabCount: number;
}

interface BookmakerStat {
  slug: string;
  name: string;
  lastUpdatedAt: string | null;
  matchCount: number;
  bySport: Record<string, number>;
  process: ProcessStat;
}

interface StatusData {
  bookmakers: BookmakerStat[];
  sports: string[];
  log: string;
  anomaliesLog: string;
  serverTime: string;
}

const SPORT_LABELS: Record<string, string> = { football: "Футбол", tennis: "Теннис", hockey: "Хоккей" };

// Кол-во ядер контейнера - используется, чтобы показать суммарный CPU% в понятном виде ("X из 8 ядер")
const CONTAINER_CORES = 8;

function formatAgo(iso: string | null, nowMs: number): string {
  if (!iso) return "никогда";
  const diffMs = nowMs - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин назад`;
  const hours = Math.floor(min / 60);
  const restMin = min % 60;
  if (hours < 24) return `${hours} ч ${restMin} мин назад`;
  const days = Math.floor(hours / 24);
  return `${days} дн ${hours % 24} ч назад`;
}

function staleness(iso: string | null, nowMs: number): "fresh" | "warn" | "stale" {
  if (!iso) return "stale";
  const min = (nowMs - new Date(iso).getTime()) / 60000;
  if (min < 20) return "fresh";
  if (min < 60) return "warn";
  return "stale";
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function logLineClass(line: string): string {
  if (line.includes("FAILED")) return "log-line log-line-error";
  if (line.startsWith("===")) return "log-line log-line-marker";
  if (line.startsWith("---")) return "log-line log-line-step";
  return "log-line";
}

// Цвет-метка перед именем конторы для "покруче"
const BOOKMAKER_COLORS: Record<string, string> = {
  booka: "#52525b",
  bookb: "#e8710a",
  bookc: "#d93025",
  bookd: "#188038",
  booke: "#9334e6",
  bookf: "#12b5cb",
  bookg: "#ffb400",
  bookh: "#00a651",
  booki: "#0b5fff",
  bookj: "#00b373",
  bookl: "#1d4ed8",
};

const BOOKMAKER_LABELS: Record<string, string> = {
  booka: "Book A",
  bookb: "Book B",
  bookc: "Book C",
  bookd: "Book D",
  booke: "Book E",
  bookf: "Book F",
  bookg: "Book G",
  bookh: "Book H",
  booki: "Book I",
  bookj: "Book J",
  bookl: "Book L",
};

// Единый вид маркеров у каждой ГРУППЫ контор свой значок и свой цвет, а не отдельный цвет у каждой конторы
const GROUP_REGULAR = { color: "#71717a", icon: "currency_ruble", title: "Обычные конторы" };
const GROUP_CRYPTO = { color: "#f7931a", icon: "currency_bitcoin", title: "Крипто-конторы" };
function dotColor(slug: string): string {
  return isCryptoSlug(slug) ? GROUP_CRYPTO.color : GROUP_REGULAR.color;
}
function GroupTitle({ group }: { group: { color: string; icon: string; title: string } }) {
  return (
    <span className="st-group-title">
      <span className="msi st-group-ico" style={{ color: group.color }}>
        {group.icon}
      </span>
      {group.title}
    </span>
  );
}

const BOOKMAKER_SLUGS = ["booka", "bookb", "bookc", "bookd", "booke", "bookf", "bookg", "bookh", "booki", "bookj", "bookl"];

interface SyncConfig {
  sports: { football: boolean; tennis: boolean; hockey: boolean };
  fullScan: boolean;
  bookmakers: Record<string, boolean>;
  aiChecks: boolean;
  fastIntervalSec: number;
  fullIntervalSec: number;
  // Какие конторы показывать на /board СРАЗУ после входа
  defaultHiddenBookmakers: string[];
  // Свой интервал опроса у каждой конторы, секунды; нет ключа = значение по умолчанию
  prematchIntervals?: Record<string, number>;
  liveIntervals?: Record<string, number>;
  cryptoDisabled?: string[];
  // Какие конторы показывать в PDF-отчётах лайва (пусто = все); применяется ко всем отчётам
  reportBooks?: string[];
}

const INTERVAL_OPTIONS = [
  { value: 0, label: "Максимально часто" },
  { value: 60, label: "Каждую минуту" },
  { value: 300, label: "Каждые 5 мин" },
  { value: 600, label: "Каждые 10 мин" },
  { value: 1800, label: "Каждые 30 мин" },
  { value: 3600, label: "Каждый час" },
];

function ToggleSwitch({
  checked,
  onChange,
  disabled,
  title,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={title}
      className={`toggle-switch${checked ? " toggle-switch-on" : ""}`}
      onClick={() => onChange(!checked)}
      disabled={disabled}
    >
      <span className="toggle-switch-knob" />
    </button>
  );
}

function CustomDropdown({
  value,
  options,
  onChange,
  title,
}: {
  value: number;
  options: { value: number; label: string }[];
  onChange: (v: number) => void;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    <div className="custom-dropdown" ref={ref} title={title}>
      <button type="button" className="custom-dropdown-trigger" onClick={() => setOpen((o) => !o)}>
        <span>{current?.label ?? "—"}</span>
        <span className={`msi custom-dropdown-arrow${open ? " custom-dropdown-arrow-open" : ""}`}>
          expand_more
        </span>
      </button>
      {open && (
        <div className="custom-dropdown-menu">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`custom-dropdown-option${o.value === value ? " custom-dropdown-option-active" : ""}`}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              <span className="msi custom-dropdown-check">{o.value === value ? "check" : ""}</span>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// "калибровка парсинга"
interface CalibrationSubmission {
  id: string;
  bookmakerSlug: string;
  bookmakerName: string;
  sportSlug: string;
  kind: string;
  url: string | null;
  hasPhoto: boolean;
  status: "PENDING" | "VERIFIED" | "FAILED" | "FLAGGED";
  extractedLeagueName: string | null;
  extractedTeams: string | null;
  matchesFound: number | null;
  message: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

const CALIBRATION_INFO: Record<
  string,
  { method: "url" | "photo-auto" | "photo-flag"; name: string; instructions: string; placeholder?: string }
> = {
  bookd: {
    method: "url",
    name: "Book D",
    instructions:
      "Откройте на bookd.ru страницу, на которой есть лига или матч, которые отображаются некорректно, и вставьте сюда ссылку на неё из адресной строки браузера.",
    placeholder: "https://example.com",
  },
  bookf: {
    method: "url",
    name: "Book F",
    instructions:
      "Откройте на bookf.ru страницу, на которой есть лига или матч, которые отображаются некорректно, и вставьте сюда ссылку на неё из адресной строки браузера.",
    placeholder: "https://example.com",
  },
  bookc: {
    method: "url",
    name: "Book C",
    instructions:
      "Откройте на bookc.ru страницу, на которой есть лига или матч, которые отображаются некорректно, и вставьте сюда ссылку на неё из адресной строки браузера.",
    placeholder: "https://example.com",
  },
  bookb: {
    method: "photo-auto",
    name: "Book B",
    instructions:
      "Сделайте скриншот страницы на bookb.ru, на которой есть лига, которая отображается некорректно - важно, чтобы на скриншоте было видно название страны и лиги (сайдбар слева или заголовок страницы).",
  },
  booka: {
    method: "photo-flag",
    name: "Book A",
    instructions:
      "Book A невозможно починить автоматически - забирает все лиги одним запросом, ссылка тут не поможет. Сделайте скриншот страницы на fon.bet, на которой есть матч, который отображается некорректно (должны быть видны обе команды и лига), для отправления заявки на починку.",
  },
  booke: {
    method: "photo-flag",
    name: "Book E",
    instructions:
      "Book E невозможно починить автоматически - тоже забирает всё одним запросом. Сделайте скриншот страницы на olimp.bet, на которой есть матч, который отображается некорректно (должны быть видны обе команды и лига), для отправления заявки на починку.",
  },
  bookh: {
    method: "photo-flag",
    name: "Book H",
    instructions:
      "Book H невозможно починить автоматически - тоже забирает всё одним запросом. Сделайте скриншот страницы на bookh.ru, на которой есть матч, который отображается некорректно (должны быть видны обе команды и лига), для отправления заявки на починку.",
  },
  bookg: {
    method: "photo-flag",
    name: "Book G",
    instructions:
      "Book G невозможно починить автоматически - забирает всё одним запросом, и у меня нет доступа к их сайту для проверки. Сделайте скриншот страницы на bookg.com, на которой есть матч, который отображается некорректно (должны быть видны обе команды и лига), для отправления заявки на починку.",
  },
};

const CALIBRATION_ORDER = ["bookd", "bookf", "bookc", "bookb", "booka", "booke", "bookh", "bookg"];

function calibStatusBadge(status: CalibrationSubmission["status"]) {
  switch (status) {
    case "VERIFIED":
      return (
        <span className="status-badge status-badge-fresh">
          <span className="msi">check_circle</span>Подключено
        </span>
      );
    case "FAILED":
      return (
        <span className="status-badge status-badge-stale">
          <span className="msi">error</span>Не удалось
        </span>
      );
    case "FLAGGED":
      return (
        <span className="status-badge calib-badge-flagged">
          <span className="msi">flag</span>Заявка отправлена
        </span>
      );
    default:
      return (
        <span className="status-badge status-badge-warn">
          <Loader inline size={16} />Проверяю…
        </span>
      );
  }
}

function CalibrationModal({ onClose, perms }: { onClose: () => void; perms: BetmarkPerms }) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [urlDrafts, setUrlDrafts] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({});
  const [submitError, setSubmitError] = useState<Record<string, string>>({});
  const [submissions, setSubmissions] = useState<CalibrationSubmission[]>([]);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const loadSubmissions = useCallback(async () => {
    try {
      const res = await fetch("/api/calibration/list");
      setSubmissions(await res.json());
    } catch {
      // тихо игнорируем - список просто не обновится в этот раз
    }
  }, []);

  useEffect(() => {
    loadSubmissions();
    // Модалка открывается редко и ненадолго - просто опрашиваем каждые 3 сек, пока она открыта
    const interval = setInterval(loadSubmissions, 3000);
    return () => clearInterval(interval);
  }, [loadSubmissions]);

  function toggle(slug: string) {
    const next = new Set(checked);
    if (next.has(slug)) next.delete(slug);
    else next.add(slug);
    setChecked(next);
  }

  async function submitUrl(slug: string) {
    const url = (urlDrafts[slug] || "").trim();
    if (!url) return;
    setSubmitting((s) => ({ ...s, [slug]: true }));
    setSubmitError((s) => ({ ...s, [slug]: "" }));
    try {
      const res = await fetch("/api/calibration/submit-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookmakerSlug: slug, sportSlug: "football", url }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "не удалось отправить");
      setUrlDrafts((d) => ({ ...d, [slug]: "" }));
      loadSubmissions();
    } catch (e) {
      setSubmitError((s) => ({ ...s, [slug]: (e as Error).message }));
    } finally {
      setSubmitting((s) => ({ ...s, [slug]: false }));
    }
  }

  async function submitPhoto(slug: string, file: File) {
    setSubmitting((s) => ({ ...s, [slug]: true }));
    setSubmitError((s) => ({ ...s, [slug]: "" }));
    try {
      const form = new FormData();
      form.append("bookmakerSlug", slug);
      form.append("sportSlug", "football");
      form.append("file", file);
      const res = await fetch("/api/calibration/submit-photo", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "не удалось отправить");
      loadSubmissions();
    } catch (e) {
      setSubmitError((s) => ({ ...s, [slug]: (e as Error).message }));
    } finally {
      setSubmitting((s) => ({ ...s, [slug]: false }));
    }
  }

  async function removeSubmission(id: string) {
    await fetch(`/api/calibration/${id}`, { method: "DELETE" }).catch(() => {});
    loadSubmissions();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Неправильные коэффициенты — калибровка парсинга</div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Закрыть">
            <span className="msi">close</span>
          </button>
        </div>
        <div className="modal-body">
          <p className="calib-intro">
            Отметьте контору, у которой лига или матч отображаются некорректно. У каждой конторы — свой способ: у
            одних автопочинка по ссылке или фото, у других (они не ходят по лигам вообще) фото уходит заявкой мне на
            разбор — это явно подписано под каждой.
          </p>

          {CALIBRATION_ORDER.map((slug) => {
            const info = CALIBRATION_INFO[slug];
            const isChecked = checked.has(slug);
            return (
              <div key={slug} className="calib-row">
                <label className="calib-checkbox-label">
                  <input type="checkbox" checked={isChecked} onChange={() => toggle(slug)} />
                  <span style={{ fontWeight: 500, color: "var(--text)" }}>{info.name}</span>
                  <span className={`calib-method-tag calib-method-tag-${info.method}`}>
                    {info.method === "url"
                      ? "ссылка · автопочинка"
                      : info.method === "photo-auto"
                        ? "фото · автопочинка"
                        : "фото · отправить заявку"}
                  </span>
                </label>

                {isChecked && (
                  <div className="calib-panel">
                    <p className="calib-instructions">{info.instructions}</p>

                    {/* право на отправку зависит от метода (url/photo-auto/photo-flag, см. lib/betmarkPermKeys.ts) */}
                    {(info.method === "url" && !perms.calibration_submit_url) ||
                    (info.method === "photo-auto" && !perms.calibration_submit_photo_auto) ||
                    (info.method === "photo-flag" && !perms.calibration_submit_photo_flag) ? (
                      <p className="calib-error">У вашего аккаунта нет права отправлять такие заявки.</p>
                    ) : info.method === "url" ? (
                      <div className="calib-input-row">
                        <input
                          type="text"
                          className="calib-url-input"
                          placeholder={info.placeholder}
                          value={urlDrafts[slug] || ""}
                          onChange={(e) => setUrlDrafts((d) => ({ ...d, [slug]: e.target.value }))}
                        />
                        <button
                          type="button"
                          className="table-refresh-btn"
                          disabled={!urlDrafts[slug]?.trim() || submitting[slug]}
                          onClick={() => submitUrl(slug)}
                          title="Проверить и подключить"
                        >
                          {submitting[slug] ? <Loader inline size={18} /> : <span className="msi">send</span>}
                        </button>
                      </div>
                    ) : (
                      <div className="calib-input-row">
                        <input
                          ref={(el) => {
                            fileInputRefs.current[slug] = el;
                          }}
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          style={{ display: "none" }}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) submitPhoto(slug, file);
                            e.target.value = "";
                          }}
                        />
                        <button
                          type="button"
                          className="logs-button"
                          disabled={submitting[slug]}
                          onClick={() => fileInputRefs.current[slug]?.click()}
                        >
                          {submitting[slug] ? <Loader inline size={18} /> : <span className="msi">add_a_photo</span>}
                          {submitting[slug] ? "Отправляю…" : "Выбрать фото"}
                        </button>
                      </div>
                    )}
                    {submitError[slug] && <p className="calib-error">{submitError[slug]}</p>}
                  </div>
                )}
              </div>
            );
          })}

          {submissions.length > 0 && (
            <>
              <h3 className="calib-history-heading">Заявки</h3>
              <div className="calib-history">
                {submissions.map((s) => (
                  <div key={s.id} className="calib-history-row">
                    <div className="calib-history-main">
                      <span style={{ fontWeight: 500, color: "var(--text)" }}>{s.bookmakerName}</span>
                      {calibStatusBadge(s.status)}
                      {s.url && (
                        <a href={s.url} target="_blank" rel="noreferrer" className="calib-history-link">
                          {s.url.length > 50 ? s.url.slice(0, 50) + "…" : s.url}
                        </a>
                      )}
                      {s.hasPhoto && !s.url && <span className="calib-history-link">фото</span>}
                      {perms.calibration_delete && (
                        <button
                          type="button"
                          className="calib-remove-btn"
                          onClick={() => removeSubmission(s.id)}
                          title="Убрать заявку"
                        >
                          <span className="msi">close</span>
                        </button>
                      )}
                    </div>
                    {s.message && <p className="calib-history-message">{s.message}</p>}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Страница "Статус"
interface DeletedMatchItem {
  id: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  sport: string;
  kickoffAt: string;
  hiddenAt: string | null;
  hiddenBy: string | null;
}

const DELETED_SPORT_LABELS: Record<string, string> = { football: "Футбол", hockey: "Хоккей", tennis: "Теннис" };

function formatKickoffShort(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" })}, ${d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
}

// Вкладка "Удалённые матчи" два списка - матчи, скрытые только у этого аккаунта, и матчи, удалённые у всех
function DeletedMatchesTab({ canRestoreAll }: { canRestoreAll: boolean }) {
  const [data, setData] = useState<{ mine: DeletedMatchItem[]; all: DeletedMatchItem[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/matches/hidden", { cache: "no-store" });
      if (!res.ok) {
        setError("Не удалось загрузить список");
        return;
      }
      setData(await res.json());
      setError(null);
    } catch {
      setError("Нет связи с сервером");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function restore(item: DeletedMatchItem, scope: "me" | "all") {
    setBusyId(item.id + scope);
    try {
      const res = await fetch("/api/matches/hide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId: item.id, scope, restore: true }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setError(j?.error || "Не удалось вернуть матч");
      } else {
        setError(null);
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function restoreAllOf(list: DeletedMatchItem[], scope: "me" | "all") {
    for (const it of list) await restore(it, scope);
  }

  if (!data && !error) return <div className="market-placeholder"><Loader label="Загрузка…" size={105} /></div>;

  const renderList = (list: DeletedMatchItem[], scope: "me" | "all") => {
    const can = scope === "me" || canRestoreAll;
    if (list.length === 0) return <div className="st-row-desc deleted-empty">Список пуст</div>;
    return list.map((m) => (
      <Row
        key={m.id + scope}
        icon="sports_soccer"
        label={`${m.homeTeam} — ${m.awayTeam}`}
        desc={`${DELETED_SPORT_LABELS[m.sport] ?? m.sport} · ${m.league} · ${formatKickoffShort(m.kickoffAt)}${scope === "all" && m.hiddenBy ? ` · удалил: ${m.hiddenBy}` : ""}`}
      >
        <button
          type="button"
          className="logs-button"
          disabled={!can || busyId === m.id + scope}
          title={can ? "Вернуть матч в таблицу" : "Нужно право «Удаление матча у ВСЕХ аккаунтов» (админ-панель, Права Betmark)"}
          onClick={() => restore(m, scope)}
        >
          {busyId === m.id + scope ? <Loader inline size={16} /> : "Вернуть"}
        </button>
      </Row>
    ));
  };

  const mine = data?.mine ?? [];
  const all = data?.all ?? [];
  return (
    <>
      {error && (
        <div className="st-note" role="alert">
          <span className="msi">warning</span>
          <span>{error}</span>
        </div>
      )}
      <Section
        icon="person"
        title="Скрыты только у вас"
        desc="Удалены кнопкой «Только у этого аккаунта»: остальные пользователи эти матчи видят."
        action={
          mine.length > 1 ? (
            <button type="button" className="logs-button" onClick={() => restoreAllOf(mine, "me")}>
              Вернуть все
            </button>
          ) : undefined
        }
      >
        {renderList(mine, "me")}
      </Section>
      <Section
        icon="groups"
        title="Удалены у всех аккаунтов"
        desc={canRestoreAll ? "Матчи, скрытые у всех пользователей. Вы можете вернуть их обратно." : "Матчи, скрытые у всех пользователей. Вернуть их может только аккаунт с правом «Удаление матча у всех»."}
        action={
          canRestoreAll && all.length > 1 ? (
            <button type="button" className="logs-button" onClick={() => restoreAllOf(all, "all")}>
              Вернуть все
            </button>
          ) : undefined
        }
      >
        {renderList(all, "all")}
      </Section>
    </>
  );
}

type TabKey = "overview" | "collect" | "display" | "reports" | "deleted" | "proxies" | "live" | "tools";

// Вкладка «Прокси» (бывшая страница /proxies): список домашних прокси с именами и удалением
function ProxiesTab() {
  const [clients, setClients] = useState<ProxyClient[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/proxies/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("bad"))))
      .then((d) => setClients(d.clients || []))
      .catch(() => setError("Не удалось получить список прокси"));
  }, []);
  if (error) return <div className="st-note" role="alert"><span className="msi">warning</span><span>{error}</span></div>;
  if (!clients) return <div className="st-empty"><Loader inline size={16} /> Загрузка…</div>;
  return <ProxyTable initialClients={clients} />;
}

// Личные настройки вида: тема и карточки матчей
function ViewPrefsSection() {
  const [theme, setTheme] = useState<ThemePref>("system");
  const [cards, setCards] = useState<CardsPref>("auto");
  const [isCrypto, setIsCrypto] = useState<boolean | null>(null);
  useEffect(() => {
    setTheme(getThemePref());
    setCards(getCardsPref());
    const host = window.location.hostname.toLowerCase();
    setIsCrypto(host.startsWith("crypto.") || host.startsWith("krypto."));
  }, []);
  const themes: { v: ThemePref; label: string }[] = [
    { v: "system", label: "Как в системе" },
    { v: "light", label: "Светлая" },
    { v: "dark", label: "Тёмная" },
  ];
  const cardModes: { v: CardsPref; label: string }[] = [
    { v: "auto", label: "Авто" },
    { v: "on", label: "Карточки" },
    { v: "off", label: "Таблица" },
  ];
  return (
    <Section icon="palette" title="Вид сайта" desc="Хранится на этом устройстве: на телефоне и на компьютере можно выбрать по-разному." badge="personal">
      <div className="vp-list">
        <div className="vp-row">
          <div>
            <div className="vp-label">Версия платформы</div>
            <div className="vp-hint">Классические букмекеры или крипто-букмекеры. Откроется соседний сайт, вход сохранится.</div>
          </div>
          <div className="view-tabs" role="group" aria-label="Версия платформы">
            {isCrypto === null ? (
              <span className="view-tab" aria-hidden="true">&nbsp;</span>
            ) : (
              <>
                {isCrypto ? <a className="view-tab" href="/api/auth/handoff?to=main&next=/board">Классические</a> : <span className="view-tab view-tab-active" aria-current="true">Классические</span>}
                {isCrypto ? <span className="view-tab view-tab-active" aria-current="true">Крипто</span> : <a className="view-tab" href="/api/auth/handoff?to=crypto&next=/board">Крипто</a>}
              </>
            )}
          </div>
        </div>
        <div className="vp-row">
          <div>
            <div className="vp-label">Тема</div>
            <div className="vp-hint">Не зависит от настройки телефона или компьютера.</div>
          </div>
          <div className="view-tabs" role="group" aria-label="Тема">
            {themes.map((t) => (
              <button key={t.v} type="button" className={`view-tab${theme === t.v ? " view-tab-active" : ""}`} aria-pressed={theme === t.v} onClick={() => { setTheme(t.v); setThemePref(t.v); }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="vp-row">
          <div>
            <div className="vp-label">Матчи на доске</div>
            <div className="vp-hint">Авто: таблица, пока она помещается, иначе карточки. На телефоне всегда карточки. Не зависит от режима «По лигам / По времени начала».</div>
          </div>
          <div className="view-tabs" role="group" aria-label="Вид матчей">
            {cardModes.map((t) => (
              <button key={t.v} type="button" className={`view-tab${cards === t.v ? " view-tab-active" : ""}`} aria-pressed={cards === t.v} onClick={() => { setCards(t.v); setCardsPref(t.v); }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}

function Section({
  icon,
  title,
  desc,
  badge,
  action,
  flush,
  children,
}: {
  icon: string;
  title: string;
  desc?: string;
  badge?: "global" | "personal";
  action?: ReactNode;
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="st-section">
      <header className="st-section-head">
        <span className="msi">{icon}</span>
        <div className="st-section-head-text">
          <div className="st-section-title">
            {title}
            {badge === "global" && (
              <span className="st-badge st-badge-global" title="Общая настройка: действует для всех аккаунтов, сохраняется кнопкой «Применить» внизу страницы">
                Для всех · нужно «Применить»
              </span>
            )}
            {badge === "personal" && (
              <span className="st-badge st-badge-personal" title="Личная настройка: действует только для вашего аккаунта и сохраняется сразу">
                Только для вас · сохраняется сразу
              </span>
            )}
          </div>
          {desc && <div className="st-section-desc">{desc}</div>}
        </div>
        {action && <div className="st-section-action">{action}</div>}
      </header>
      <div className={flush ? "st-section-body-flush" : "st-section-body"}>{children}</div>
    </section>
  );
}

function Row({
  icon,
  dot,
  label,
  desc,
  off,
  children,
}: {
  icon?: string;
  dot?: string;
  label: string;
  desc?: string;
  off?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`st-row${off ? " st-row-off" : ""}`}>
      <div className="st-row-text">
        <div className="st-row-label">
          {icon && <span className="msi">{icon}</span>}
          {dot && <span className="bookmaker-dot" style={{ background: dot }} />}
          {label}
        </div>
        {desc && <div className="st-row-desc">{desc}</div>}
      </div>
      <div className="st-row-control">{children}</div>
    </div>
  );
}

// Плашка-переключатель конторы (как в окне live-трекера): нажал - включил/выключил; включённая подсвечена синим
function ChipToggle({
  on,
  label,
  dot,
  icon,
  disabled,
  title,
  onClick,
}: {
  on: boolean;
  label: string;
  dot?: string;
  icon?: string;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" role="switch" aria-checked={on} className={`st-chip${on ? " st-chip-on" : ""}${icon ? " st-chip-icon" : ""}`} disabled={disabled} title={title} onClick={onClick}>
      <span className="msi">{icon ?? (on ? "check_circle" : "radio_button_unchecked")}</span>
      {dot && <span className="bookmaker-dot" style={{ background: dot }} />}
      {label}
    </button>
  );
}

// Раздел "Отображение": ВСЁ, что определяет набор контор на доске example.com, в одном блоке
function DisplayTab({
  draftConfig,
  editDraft,
  canEdit,
}: {
  draftConfig: SyncConfig | null;
  editDraft: (patch: Partial<SyncConfig>) => void;
  canEdit: boolean;
}) {
  const [allBookmakers, setBookmakers] = useState<{ slug: string; name: string }[] | null>(null);
  const isParsed = useParsedBooks(); // только парсящиеся конторы
  const bookmakers = allBookmakers ? allBookmakers.filter((b) => isParsed(b.slug)) : null;
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/user-settings")
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        setBookmakers(data.bookmakers ?? []);
        setEnabled(new Set<string>(data.cryptoOnMain ?? []));
      })
      .catch((e) => {
        if (!cancelled) setError(`не удалось загрузить личную настройку (${e instanceof Error ? e.message : String(e)})`);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveCrypto(next: Set<string>) {
    const prev = enabled;
    setEnabled(next);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/user-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cryptoOnMain: [...next] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1800);
    } catch (e) {
      setEnabled(prev);
      setError(`не удалось сохранить (${e instanceof Error ? e.message : String(e)})`);
    } finally {
      setBusy(false);
    }
  }

  const hidden = new Set(draftConfig?.defaultHiddenBookmakers ?? []);
  const regularOn = BOOKMAKER_SLUGS.filter((s) => !hidden.has(s)).length;
  const cryptoOn = bookmakers ? bookmakers.filter((b) => enabled.has(b.slug)).length : 0;

  return (
    <>
    <ViewPrefsSection />
    <Section
      icon="view_column"
      title="Конторы на доске example.com"
      desc="Нажмите на контору, чтобы включить или выключить её: включённые отмечены галочкой. Скрытые конторы всегда можно вернуть вручную в фильтрах доски."
    >
      <div className="st-group">
        <div className="st-group-head">
          <GroupTitle group={GROUP_REGULAR} />
          <span className="st-badge st-badge-global" title="Общая настройка: действует для всех аккаунтов, сохраняется кнопкой «Применить» внизу страницы">
            Для всех · нужно «Применить»
          </span>
          <div className="st-group-actions">
            <button type="button" className="st-link-btn" disabled={!canEdit || !draftConfig} onClick={() => editDraft({ defaultHiddenBookmakers: [] })}>
              Все
            </button>
            <button type="button" className="st-link-btn" disabled={!canEdit || !draftConfig} onClick={() => editDraft({ defaultHiddenBookmakers: [...BOOKMAKER_SLUGS] })}>
              Ни одной
            </button>
          </div>
        </div>
        <div className="st-group-desc">Какие конторы видны на доске сразу после входа. На сбор данных это не влияет.</div>
        {!draftConfig ? (
          <div className="st-muted"><Loader label="Загрузка настроек…" size={77} /></div>
        ) : (
          <div className="st-chips">
            {BOOKMAKER_SLUGS.map((slug) => {
              const on = !hidden.has(slug);
              return (
                <ChipToggle
                  key={slug}
                  on={on}
                  label={BOOKMAKER_LABELS[slug]}
                  dot={dotColor(slug)}
                  disabled={!canEdit}
                  title={on ? `${BOOKMAKER_LABELS[slug]}: видна сразу после входа` : `${BOOKMAKER_LABELS[slug]}: скрыта, включается вручную в фильтрах`}
                  onClick={() =>
                    editDraft({
                      defaultHiddenBookmakers: on ? [...draftConfig.defaultHiddenBookmakers, slug] : draftConfig.defaultHiddenBookmakers.filter((x) => x !== slug),
                    })
                  }
                />
              );
            })}
          </div>
        )}
      </div>

      <div className="st-group">
        <div className="st-group-head">
          <GroupTitle group={GROUP_CRYPTO} />
          <span className="st-badge st-badge-personal" title="Личная настройка: действует только для вашего аккаунта и сохраняется сразу">
            Только для вас · сохраняется сразу
          </span>
          <div className="st-group-actions">
            {savedFlash && <span className="st-saved-flash">Сохранено</span>}
            <button type="button" className="st-link-btn" disabled={busy || !bookmakers} onClick={() => bookmakers && saveCrypto(new Set(bookmakers.map((b) => b.slug)))}>
              Все
            </button>
            <button type="button" className="st-link-btn" disabled={busy || !bookmakers} onClick={() => saveCrypto(new Set())}>
              Ни одной
            </button>
          </div>
        </div>
        <div className="st-group-desc">
          Включённые крипто-конторы появятся на example.com среди остальных (доска и страница матча). В крипто-версии (example.com) всегда показываются все.
        </div>
        {error && <div className="st-error">{error}</div>}
        {!bookmakers && !error && <div className="st-muted"><Loader label="Загрузка…" size={63} /></div>}
        {bookmakers && (
          <div className="st-chips">
            {bookmakers.map((b) => (
              <ChipToggle
                key={b.slug}
                on={enabled.has(b.slug)}
                label={b.name}
                dot={dotColor(b.slug)}
                disabled={busy}
                title={enabled.has(b.slug) ? `Убрать ${b.name} из обычного Betmark` : `Показывать ${b.name} в обычном Betmark`}
                onClick={() => {
                  const next = new Set(enabled);
                  if (next.has(b.slug)) next.delete(b.slug);
                  else next.add(b.slug);
                  saveCrypto(next);
                }}
              />
            ))}
          </div>
        )}
      </div>

      <div className="st-total">
        <span className="msi">dashboard</span>
        <span>
          На вашей доске example.com по умолчанию: <b>{regularOn}</b> из {BOOKMAKER_SLUGS.length} обычных и <b>{cryptoOn}</b> из {bookmakers?.length ?? 0} крипто-контор.
        </span>
      </div>
    </Section>
    </>
  );
}

// Раздел "Сбор данных": что собираем, откуда и как часто
const SPORT_DEFS: { key: "football" | "tennis" | "hockey"; label: string; icon: string }[] = [
  { key: "football", label: "Футбол", icon: "sports_soccer" },
  { key: "tennis", label: "Теннис", icon: "sports_tennis" },
  { key: "hockey", label: "Хоккей", icon: "sports_hockey" },
];

function intervalLabel(sec: number): string {
  return (INTERVAL_OPTIONS.find((o) => o.value === sec)?.label ?? `${sec} с`).toLowerCase();
}

const INTERVAL_CRYPTO: { slug: string; label: string }[] = [
  { slug: "bookm", label: "Book M" },
  { slug: "booko", label: "Book O" },
  { slug: "bookn", label: "Book N" },
  { slug: "bookp", label: "Book P" },
  { slug: "books", label: "Book S" },
  { slug: "booku", label: "Book U" },
  { slug: "bookt", label: "Book T" },
  { slug: "bookq", label: "Book Q" },
];
const LIVE_STEP_SLUGS = new Set(["booke", "bookd", "bookb", "bookf", "bookc", "bookg", "bookh", "booki", "bookj", "bookk", "bookm", "booko", "bookp", "books", "booku", "bookt"]);
const PREMATCH_STEPS = [0, 30, 60, 120, 300, 600, 900, 1800, 3600];
const CRYPTO_PREMATCH_STEPS = [300, 600, 900, 1800, 3600];
const LIVE_STEPS = [5, 10, 15, 30, 60, 120];

function stepLabel(sec: number): string {
  if (sec === 0) return "Максимально часто";
  if (sec < 60) return `Каждые ${sec} с`;
  if (sec === 60) return "Каждую минуту";
  if (sec < 3600) return `Каждые ${sec / 60} мин`;
  return "Каждый час";
}

function IntervalsGroup({
  draftConfig,
  editDraft,
  canEdit,
}: {
  draftConfig: SyncConfig;
  editDraft: (patch: Partial<SyncConfig>) => void;
  canEdit: boolean;
}) {
  const isParsed = useParsedBooks(); // неработающие конторы в списке не показываем
  const pm = draftConfig.prematchIntervals ?? {};
  const lv = draftConfig.liveIntervals ?? {};
  const setPm = (slug: string, v: number) => {
    const next = { ...pm };
    if (v < 0) delete next[slug];
    else next[slug] = v;
    editDraft({ prematchIntervals: next });
  };
  const setLv = (slug: string, v: number) => {
    const next = { ...lv };
    if (v < 0) delete next[slug];
    else next[slug] = v;
    editDraft({ liveIntervals: next });
  };
  const off = new Set(draftConfig.cryptoDisabled ?? []);
  const setOff = (slug: string, disabled: boolean) => {
    const next = new Set(off);
    if (disabled) next.add(slug);
    else next.delete(slug);
    editDraft({ cryptoDisabled: [...next] });
  };
  const opts = (def: string, steps: number[]) => [{ value: -1, label: def }, ...steps.map((s) => ({ value: s, label: stepLabel(s) }))];
  const regular = [...BOOKMAKER_SLUGS.map((slug) => ({ slug, label: BOOKMAKER_LABELS[slug] ?? slug })), { slug: "bookk", label: "Book K" }];
  const muted = (text: string) => <div className="st-int-note">{text}</div>;

  const row = (slug: string, label: string, crypto: boolean) => {
    let prematch: ReactNode;
    if (slug === "bookk") prematch = muted("агент на ПК, своё расписание");
    else if (crypto) prematch = <CustomDropdown value={pm[slug] ?? -1} options={opts("По умолчанию", CRYPTO_PREMATCH_STEPS)} onChange={(v) => setPm(slug, v)} title={`${label}: как часто собирать прематч`} />;
    else
      prematch = (
        <CustomDropdown
          value={pm[slug] ?? -1}
          options={opts(slug === "bookc" ? "По умолчанию (ПК)" : "По умолчанию", PREMATCH_STEPS)}
          onChange={(v) => setPm(slug, v)}
          title={`${label}: как часто собирать прематч`}
        />
      );
    let live: ReactNode;
    if (slug === "booka") live = muted("источник счёта: каждый опрос матча");
    else if (!LIVE_STEP_SLUGS.has(slug)) live = muted("live нет");
    else live = <CustomDropdown value={lv[slug] ?? -1} options={opts(slug === "bookc" ? "По умолчанию (ПК)" : "По умолчанию", LIVE_STEPS)} onChange={(v) => setLv(slug, v)} title={`${label}: как часто опрашивать в live`} />;
    const isOff = crypto && off.has(slug);
    return (
      <div className="st-int-row" key={slug}>
        <div className="st-int-name">
          <span className="bookmaker-dot" style={{ background: dotColor(slug) }} />
          {label}
          {crypto && (
            <button type="button" role="switch" aria-checked={!isOff} className={`st-int-switch${isOff ? "" : " st-int-switch-on"}`} title={isOff ? `${label}: сбор выключен, контора убрана. Нажмите, чтобы вернуть` : `${label}: сбор идёт. Нажмите, чтобы убрать конторы`} onClick={() => setOff(slug, !isOff)}>
              {isOff ? "Убрана" : "Сбор вкл"}
            </button>
          )}
        </div>
        <div className="st-int-cell" data-custom={String(pm[slug] !== undefined)} style={isOff ? { opacity: 0.4, pointerEvents: "none" } : undefined}>
          <span className="st-int-cap">Прематч</span>
          {prematch}
        </div>
        <div className="st-int-cell" data-custom={String(lv[slug] !== undefined)} style={isOff ? { opacity: 0.4, pointerEvents: "none" } : undefined}>
          <span className="st-int-cap">Live</span>
          {live}
        </div>
      </div>
    );
  };

  return (
    <div className="st-group">
      <div className="st-group-head">
        <span className="st-group-title">Индивидуальные интервалы</span>
        <div className="st-group-actions">
          <button type="button" className="st-link-btn" disabled={!canEdit} onClick={() => editDraft({ prematchIntervals: {}, liveIntervals: {} })} title="Сбрасывает только интервалы; убранные крипто-конторы остаются убранными">
            Сбросить по умолчанию
          </button>
        </div>
      </div>
      <div className="st-group-desc">
        Настройка частоты опроса каждого букмекера. Прематч — интервал полного обновления линии (источники работают независимо). Live — частота запроса котировок в отслеживаемых матчах. Короткий интервал повышает актуальность данных, но увеличивает нагрузку и риск ограничений со стороны букмекера.
      </div>
      <div className="st-int-grid" style={canEdit ? undefined : { pointerEvents: "none", opacity: 0.55 }}>
        <div className="st-int-head" aria-hidden="true">
          <span>Букмекер</span>
          <span>Прематч <em>как часто обновлять линию</em></span>
          <span>Live <em>как часто опрашивать матч</em></span>
        </div>
        <div className="st-int-sub">
          <GroupTitle group={GROUP_REGULAR} />
        </div>
        {regular.map((b) => row(b.slug, b.label, false))}
        <div className="st-int-sub">
          <GroupTitle group={GROUP_CRYPTO} />
        </div>
        {INTERVAL_CRYPTO.filter((b) => isParsed(b.slug)).map((b) => row(b.slug, b.label, true))}
      </div>
    </div>
  );
}

function CollectTab({
  draftConfig,
  editDraft,
  canEdit,
}: {
  draftConfig: SyncConfig | null;
  editDraft: (patch: Partial<SyncConfig>) => void;
  canEdit: boolean;
}) {
  if (!draftConfig) return <div className="st-muted"><Loader label="Загрузка настроек…" size={77} /></div>;

  const sportsOn = SPORT_DEFS.filter((d) => draftConfig.sports[d.key]);
  const booksOn = BOOKMAKER_SLUGS.filter((slug) => draftConfig.bookmakers[slug] ?? true);
  const setAllBooks = (value: boolean) => editDraft({ bookmakers: Object.fromEntries(BOOKMAKER_SLUGS.map((slug) => [slug, value])) });

  return (
    <Section
      icon="cloud_sync"
      title="Сбор данных"
      desc="Что, откуда и как часто собирает система. Настройка общая для всех аккаунтов: после изменений нажмите «Применить» внизу."
      badge="global"
    >
      <div className="st-group">
        <div className="st-group-head">
          <span className="st-group-title">Что собираем</span>
        </div>
        <div className="st-group-desc">Виды спорта. Выключенный вид спорта перестаёт собираться у всех контор.</div>
        <div className="st-chips">
          {SPORT_DEFS.map((d) => (
            <ChipToggle
              key={d.key}
              on={draftConfig.sports[d.key]}
              label={d.label}
              icon={d.icon}
              disabled={!canEdit}
              title={draftConfig.sports[d.key] ? `Выключить сбор: ${d.label}` : `Включить сбор: ${d.label}`}
              onClick={() => editDraft({ sports: { ...draftConfig.sports, [d.key]: !draftConfig.sports[d.key] } })}
            />
          ))}
        </div>
      </div>

      <div className="st-group">
        <div className="st-group-head">
          <GroupTitle group={{ ...GROUP_REGULAR, title: "Откуда собираем" }} />
          <div className="st-group-actions">
            <button type="button" className="st-link-btn" disabled={!canEdit} onClick={() => setAllBooks(true)}>
              Все
            </button>
            <button type="button" className="st-link-btn" disabled={!canEdit} onClick={() => setAllBooks(false)}>
              Ни одной
            </button>
          </div>
        </div>
        <div className="st-group-desc">Конторы, у которых забираются коэффициенты. У выключенной данные перестают обновляться и устаревают.</div>
        <div className="st-chips">
          {BOOKMAKER_SLUGS.map((slug) => {
            const on = draftConfig.bookmakers[slug] ?? true;
            return (
              <ChipToggle
                key={slug}
                on={on}
                label={BOOKMAKER_LABELS[slug]}
                dot={dotColor(slug)}
                disabled={!canEdit}
                title={on ? `${BOOKMAKER_LABELS[slug]}: сбор идёт` : `${BOOKMAKER_LABELS[slug]}: сбор выключен`}
                onClick={() => editDraft({ bookmakers: { ...draftConfig.bookmakers, [slug]: !on } })}
              />
            );
          })}
        </div>
      </div>

      <div className="st-group">
        <div className="st-group-head">
          <span className="st-group-title">Охват лиг (футбол)</span>
        </div>
        <div className="st-group-desc">
          {draftConfig.fullScan
            ? "Сканируются все доступные турниры букмекеров (до 270 лиг), включая региональные и низшие дивизионы. Повышает нагрузку на систему."
            : "Сканируются только топ-6 чемпионатов и еврокубки — оптимальная скорость и ничего лишнего. Полный охват рекомендуется включать только при необходимости."}
        </div>
        <div className="st-seg" role="radiogroup" aria-label="Охват футбольных лиг">
          <button type="button" role="radio" aria-checked={!draftConfig.fullScan} className={`st-seg-btn${!draftConfig.fullScan ? " st-seg-btn-on" : ""}`} disabled={!canEdit} onClick={() => editDraft({ fullScan: false })}>
            Топ-6 лиг и еврокубки
          </button>
          <button type="button" role="radio" aria-checked={draftConfig.fullScan} className={`st-seg-btn${draftConfig.fullScan ? " st-seg-btn-on" : ""}`} disabled={!canEdit} onClick={() => editDraft({ fullScan: true })}>
            Все лиги
          </button>
        </div>
      </div>

      <div className="st-group">
        <div className="st-group-head">
          <span className="st-group-title">Частота обновления прематча</span>
        </div>
        <div className="st-group-desc">Как часто собирается линия до начала матчей (прематч). Live-опрос настраивается ниже, у каждой конторы отдельно.</div>
        <div className="st-fields">
          <div className="st-field" style={canEdit ? undefined : { pointerEvents: "none", opacity: 0.55 }}>
            <div className="st-field-label">Ведущие лиги, хоккей и теннис</div>
            <CustomDropdown value={draftConfig.fastIntervalSec} options={INTERVAL_OPTIONS} onChange={(v) => editDraft({ fastIntervalSec: v })} title="Интервал обновления ведущих лиг, хоккея и тенниса" />
          </div>
          <div
            className={`st-field${draftConfig.fullScan ? "" : " st-field-off"}`}
            style={canEdit && draftConfig.fullScan ? undefined : { pointerEvents: "none", opacity: 0.85 }}
            title={draftConfig.fullScan ? undefined : "Доступно только в режиме «Все лиги»"}
          >
            <div className="st-field-label">Все лиги {draftConfig.fullScan ? "" : "(отключено)"}</div>
            <CustomDropdown value={draftConfig.fullIntervalSec} options={INTERVAL_OPTIONS} onChange={(v) => editDraft({ fullIntervalSec: v })} title="Интервал обновления остальных лиг" />
          </div>
        </div>
      </div>

      <IntervalsGroup draftConfig={draftConfig} editDraft={editDraft} canEdit={canEdit} />

      <div className="st-group">
        <div className="st-group-head">
          <span className="st-group-title">Проверка данных ИИ</span>
        </div>
        <div className="st-group-desc">ИИ ищет дубли матчей и аномальные коэффициенты и подсказывает, что исправить.</div>
        <div className="st-chips">
          <ChipToggle
            on={draftConfig.aiChecks}
            label={draftConfig.aiChecks ? "AI-проверки включены" : "AI-проверки выключены"}
            icon="psychology"
            disabled={!canEdit}
            title={draftConfig.aiChecks ? "Выключить AI-проверки" : "Включить AI-проверки"}
            onClick={() => editDraft({ aiChecks: !draftConfig.aiChecks })}
          />
        </div>
      </div>

      <div className="st-total">
        <span className="msi">info</span>
        <span>
          Сейчас собираются: <b>{sportsOn.length > 0 ? sportsOn.map((d) => d.label.toLowerCase()).join(", ") : "ничего"}</b> · <b>{booksOn.length}</b> из {BOOKMAKER_SLUGS.length} контор · основные лиги{" "}
          <b>{intervalLabel(draftConfig.fastIntervalSec)}</b>
          {draftConfig.fullScan && (
            <>
              , все лиги <b>{intervalLabel(draftConfig.fullIntervalSec)}</b>
            </>
          )}
          .
        </span>
      </div>
    </Section>
  );
}

// Раздел «Отчёты»
function ReportsTab() {
  const isParsed = useParsedBooks(); // только парсящиеся конторы
  const regular = (LIVE_ADAPTER_SLUGS as readonly string[]).filter(isParsed);
  const crypto = (CRYPTO_LIVE_ADAPTER_SLUGS as readonly string[]).filter(isParsed);
  const all = [...regular, ...crypto];
  const nameOf = (slug: string) => (LIVE_ADAPTER_DISPLAY as Record<string, string>)[slug] ?? (CRYPTO_LIVE_ADAPTER_DISPLAY as Record<string, string>)[slug] ?? slug;
  const [picked, setPicked] = useState<Set<string>>(new Set(all));
  const [savedKey, setSavedKey] = useState("all");
  const [prepare, setPrepare] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const keyOf = (set: Set<string>) => (all.every((slug) => set.has(slug)) ? "all" : all.filter((slug) => set.has(slug)).join(","));
  useEffect(() => {
    fetch("/api/report-books")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j) => {
        const books: string[] = Array.isArray(j?.books) ? j.books : [];
        setPicked(new Set(books.length > 0 ? books : all));
        setSavedKey(books.length > 0 ? books.join(",") : "all");
        setPrepare(j?.prepare === true);
      })
      .catch(() => setMsg("Не удалось загрузить ваш набор (нет доступа к настройкам лайва?)"))
      .finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const dirty = keyOf(picked) !== savedKey;
  const allOn = keyOf(picked) === "all";
  const toggle = (slug: string) => {
    const next = new Set(picked);
    if (next.has(slug)) next.delete(slug);
    else next.add(slug);
    if (next.size > 0) setPicked(next); // хотя бы одна контора
  };
  const save = async (prep: boolean | null) => {
    setBusy(true);
    try {
      const res = await fetch("/api/report-books", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ books: allOn ? [] : all.filter((slug) => picked.has(slug)), prepare: prep === true }) });
      if (!res.ok) {
        setMsg("Не удалось сохранить");
        return;
      }
      setSavedKey(keyOf(picked));
      setPrepare(prep === true);
      setAsking(false);
      setMsg("Сохранено");
      setTimeout(() => setMsg(null), 2500);
    } catch {
      setMsg("Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  };
  const group = (title: string, grp: { color: string; icon: string; title: string }, list: readonly string[]) => (
    <div className="st-group">
      <div className="st-group-head">
        <GroupTitle group={{ ...grp, title }} />
        <div className="st-group-actions">
          <button type="button" className="st-link-btn" onClick={() => setPicked(new Set([...picked, ...list]))}>
            Все
          </button>
          <button type="button" className="st-link-btn" disabled={all.filter((slug) => picked.has(slug) && !list.includes(slug)).length === 0} onClick={() => setPicked(new Set([...picked].filter((slug) => !list.includes(slug))))}>
            Ни одной из этих
          </button>
        </div>
      </div>
      <div className="st-chips">
        {list.map((slug) => (
          <ChipToggle key={slug} on={picked.has(slug)} label={nameOf(slug)} dot={dotColor(slug)} title={picked.has(slug) ? `${nameOf(slug)}: показывается в ваших отчётах` : `${nameOf(slug)}: не показывается в ваших отчётах`} onClick={() => toggle(slug)} />
        ))}
      </div>
    </div>
  );
  return (
    <Section icon="description" title="Отчёты" desc="Какие конторы попадают в ваши PDF-отчёты лайва. Настройка личная (у других аккаунтов свой набор) и применяется ко всем вашим отчётам." badge="personal">
      {!loaded ? (
        <div className="st-muted"><Loader label="Загрузка…" size={63} /></div>
      ) : (
        <>
          {group("Обычные конторы", GROUP_REGULAR, regular)}
          {group("Крипто-конторы", GROUP_CRYPTO, crypto)}
          <div className="st-total">
            <span className="msi">info</span>
            <span>
              {allOn ? (
                <>В ваших отчётах показываются <b>все</b> конторы ({all.length}).</>
              ) : (
                <>В ваших отчётах показываются <b>{picked.size}</b> из {all.length} контор.</>
              )}{" "}
              {savedKey !== "all" && (prepare ? "Отчёты по вашему набору сервер готовит заранее для всех будущих матчей. " : "Отчёты по вашему набору собираются при первом скачивании (около 10 секунд), дальше открываются сразу. ")}
              Если у матча нет данных от выбранной конторы, её колонки не будет. Та же настройка есть на странице лайва: кнопка «Конторы в отчётах».
              {msg && <b style={{ marginLeft: 8 }}>{msg}</b>}
            </span>
          </div>
          <div style={{ marginTop: 12 }}>
            <button type="button" className="logs-button" disabled={!dirty || busy} onClick={() => (allOn ? save(null) : setAsking(true))}>
              <span className="msi">check</span>
              Сохранить набор
            </button>
          </div>
          {asking && <ReportPrepareAsk count={picked.size} busy={busy} err={null} onAnswer={(p) => save(p)} onBack={() => setAsking(false)} />}
        </>
      )}
    </Section>
  );
}

// сколько секунд обычно занимает ручное обновление (подпись на кнопке, полоска прогресса и обратный отсчёт)
const REFRESH_WAIT_SEC = 30;

export default function StatusPage() {
  const [data, setData] = useState<StatusData | null>(null);
  const [now, setNow] = useState(Date.now());
  const [savedConfig, setSavedConfig] = useState<SyncConfig | null>(null);
  const [draftConfig, setDraftConfig] = useState<SyncConfig | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [logsModal, setLogsModal] = useState<"sync" | "anomalies" | null>(null);
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const [refreshState, setRefreshState] = useState<"idle" | "triggering" | "done" | "finished">("idle");
  const [refreshStartedAt, setRefreshStartedAt] = useState(0);
  const [tab, setTab] = useState<TabKey>("overview");
  const { perms, hasAccess, loading: permsLoading } = useBetmarkPerms();
  const isParsedBook = useParsedBooks(); // убранные конторы не считаем ни в сводке, ни в таблице

  // выбранный раздел запоминается в адресе (#collect) - на него можно дать ссылку
  useEffect(() => {
    const h = window.location.hash.replace("#", "");
    if (h === "overview" || h === "collect" || h === "display" || h === "reports" || h === "deleted" || h === "proxies" || h === "live" || h === "tools") setTab(h);
  }, []);
  function selectTab(t: TabKey) {
    setTab(t);
    try {
      window.history.replaceState(null, "", `#${t}`);
    } catch {
      // адресная строка недоступна - не страшно
    }
  }

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/sync-status");
      if (!res.ok) return;
      setData(await res.json());
    } catch {
      // следующий тик через 30 сек
    }
  }, []);

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 30000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(interval);
      clearInterval(clock);
    };
  }, [loadStatus]);

  async function refreshNow() {
    setRefreshState("triggering");
    try {
      await fetch("/api/sync-now", { method: "POST" });
    } catch {
      // всё равно покажем "запущено" - статус обновится сам
    }
    setRefreshStartedAt(Date.now());
    setRefreshState("done");
    // пока идёт синк (~30 сек) статус перечитывается по ходу - цифры в таблице оживают без перезагрузки страницы
    for (const delay of [6000, 12000, 18000, 24000, 30000, 36000]) setTimeout(loadStatus, delay);
    setTimeout(() => setRefreshState("finished"), REFRESH_WAIT_SEC * 1000 + 1500);
    setTimeout(() => setRefreshState("idle"), REFRESH_WAIT_SEC * 1000 + 4500);
  }

  useEffect(() => {
    fetch("/api/sync-config")
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => {
        if (!cfg) return;
        setSavedConfig(cfg);
        setDraftConfig(cfg);
      })
      .catch(() => {});
  }, []);

  function editDraft(patch: Partial<SyncConfig>) {
    if (!draftConfig) return;
    setDraftConfig({ ...draftConfig, ...patch });
  }

  const hasChanges = !!draftConfig && !!savedConfig && JSON.stringify(draftConfig) !== JSON.stringify(savedConfig);

  async function applyConfig() {
    if (!draftConfig || !hasChanges) return;
    setSaveState("saving");
    try {
      const res = await fetch("/api/sync-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draftConfig),
      });
      const saved = await res.json();
      setSavedConfig(saved);
      setDraftConfig(saved);
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2500);
    } catch {
      setSaveState("idle");
    }
  }

  function discardDraft() {
    setDraftConfig(savedConfig);
  }

  const books = data ? data.bookmakers.filter((b) => isParsedBook(b.slug)) : [];
  const summary = data
    ? (() => {
        const stales = books.map((b) => staleness(b.lastUpdatedAt, now));
        const freshCount = stales.filter((s) => s === "fresh").length;
        const staleCount = stales.filter((s) => s === "stale").length;
        const ages = books
          .map((b) => b.lastUpdatedAt)
          .filter((iso): iso is string => iso !== null)
          .map((iso) => now - new Date(iso).getTime());
        const oldestIso =
          ages.length > 0
            ? books.find((b) => b.lastUpdatedAt && now - new Date(b.lastUpdatedAt).getTime() === Math.max(...ages))?.lastUpdatedAt ?? null
            : null;
        const runningCount = books.filter((b) => b.process.running).length;
        const totalCpu = books.reduce((sum, b) => sum + b.process.cpuPercent, 0);
        const totalMem = books.reduce((sum, b) => sum + b.process.memMb, 0);
        const totalMatches = books.reduce((sum, b) => sum + Object.values(b.bySport).reduce((a, c) => a + c, 0), 0);
        return { freshCount, staleCount, total: books.length, oldestIso, runningCount, totalCpu, totalMem, totalMatches };
      })()
    : null;

  if (!permsLoading && (!hasAccess || !perms.status_view)) {
    return (
      <>
        <header className="header">
          <SiteHeader />
        </header>
        <main className="main">
          <div className="page-subtitle">
            {hasAccess ? "У вашего аккаунта нет доступа к этому разделу." : "Доступ к Betmark для этого аккаунта отключён."}
          </div>
        </main>
      </>
    );
  }

  const canEdit = !!perms.sync_edit_config;
  const canSeeTools = !!perms.sync_view_logs || !!perms.calibration_view;
  const activeTab: TabKey = (tab === "tools" && !canSeeTools) || (tab === "deleted" && !perms.board_view) || (tab === "proxies" && !perms.proxies_view) || (tab === "live" && !perms.live_view) ? "overview" : tab;

  const tabs: { key: TabKey; icon: string; label: string; hint: string; dirty?: boolean }[] = [
    { key: "overview", icon: "monitoring", label: "Состояние", hint: "Кто и когда обновлялся" },
    { key: "collect", icon: "cloud_sync", label: "Сбор данных", hint: "Что, откуда и как часто собираем", dirty: hasChanges },
    { key: "display", icon: "visibility", label: "Отображение", hint: "Что видно на сайте", dirty: hasChanges },
    { key: "reports", icon: "description", label: "Отчёты", hint: "Какие конторы показывать в ваших отчётах лайва" },
    ...(perms.board_view ? [{ key: "deleted" as TabKey, icon: "delete_sweep", label: "Удалённые матчи", hint: "Матчи, удалённые с доски: можно вернуть обратно" }] : []),
    ...(perms.live_view ? [{ key: "live" as TabKey, icon: "sensors", label: "Парсинг", hint: "Состояние движка Live-трекера по букмекерам" }] : []),
    ...(perms.proxies_view ? [{ key: "proxies" as TabKey, icon: "dns", label: "Прокси", hint: "Домашние прокси для парсинга" }] : []),
    ...(canSeeTools ? [{ key: "tools" as TabKey, icon: "build", label: "Инструменты", hint: "Логи и калибровка парсинга" }] : []),
  ];

  const readOnlyNote = !canEdit && (
    <div className="st-note">
      <span className="msi">lock</span> Только просмотр: у вашего аккаунта нет права менять общие настройки синхронизации.
    </div>
  );

  // таблица контор: сначала обычные, потом крипто (общий порядок внутри группы сохраняется)
  const regularBookmakers = data ? books.filter((b) => !isCryptoSlug(b.slug)) : [];
  const cryptoBookmakers = data ? books.filter((b) => isCryptoSlug(b.slug)) : [];
  const columnCount = (data?.sports.length ?? 0) + 5;

  function renderBookmakerRow(b: BookmakerStat) {
    const st = staleness(b.lastUpdatedAt, now);
    return (
      <tr key={b.slug}>
        <td className="col-league">
          <div className="bookmaker-name-cell">
            <span className="bookmaker-dot" style={{ background: dotColor(b.slug) }} />
            <span style={{ color: "var(--text)", fontWeight: 500 }}>{b.name}</span>
          </div>
        </td>
        {data?.sports.map((s) => (
          <td key={s} className="col-bookmaker" data-label={DELETED_SPORT_LABELS[s] ?? s}>
            <span className="sport-count-badge">{(b.bySport[s] ?? 0).toLocaleString("ru-RU")}</span>
          </td>
        ))}
        <td className="col-bookmaker" data-label="Обновлено">{b.lastUpdatedAt ? formatTime(b.lastUpdatedAt) : "—"}</td>
        <td className="col-bookmaker" data-label="Когда">{formatAgo(b.lastUpdatedAt, now)}</td>
        <td className="col-bookmaker" data-label="Статус">
          <span className={`status-badge status-badge-${st}`}>
            <span className="msi">{st === "fresh" ? "check_circle" : st === "warn" ? "warning" : "error"}</span>
            {st === "fresh" ? "Актуально" : st === "warn" ? "Задержка" : "Не актуально"}
          </span>
        </td>
        <td className="col-bookmaker" data-label="Процесс">
          {b.process.running ? (
            <span className="proc-badge proc-badge-running">
              <span className="msi">sync</span>
              {b.process.mode ?? "работает"}<span className="proc-extra"> · {b.process.tabCount} {b.process.tabCount === 1 ? "вкладка" : "вкладки"} · {b.process.cpuPercent}% CPU · {b.process.memMb} МБ</span>
            </span>
          ) : (
            <span className="proc-badge proc-badge-idle">
              <span className="msi">pause_circle</span>простаивает
            </span>
          )}
        </td>
      </tr>
    );
  }

  return (
    <>
      <header className="header">
        <SiteHeader />
      </header>

      <main className="main st-main">
        <div className="match-header">
          <h1 className="match-header-title">Настройки</h1>
          <div className="match-header-meta">{data ? `Обновлено на странице: ${formatTime(new Date(now).toISOString())}` : <><Loader inline size={16} /> Загрузка…</>}</div>
        </div>

        {summary && (
          <div className="status-summary">
            <div className="status-card" title="Сколько контор синкались за последние 20 минут - порог, после которого данные считаются устаревшими.">
              <div className="status-card-label">
                <span className="msi">verified</span> Актуально
              </div>
              <div className={`status-card-value${summary.staleCount === 0 ? " status-card-value-good" : ""}`}>
                {summary.freshCount} / {summary.total}
              </div>
              <div className="status-card-sub">контор обновлялись за последние 20 мин</div>
            </div>
            <div className="status-card" title="Время с последнего обновления у самой отстающей конторы.">
              <div className="status-card-label">
                <span className="msi">schedule</span> Худшее обновление
              </div>
              <div className={`status-card-value${summary.staleCount > 0 ? " status-card-value-bad" : ""}`}>
                {summary.oldestIso ? formatAgo(summary.oldestIso, now) : "—"}
              </div>
              <div className="status-card-sub">по самой отстающей конторе</div>
            </div>
            <div className="status-card" title="Сколько контор синкается прямо сейчас и суммарная нагрузка на процессор и память.">
              <div className="status-card-label">
                <span className="msi">bolt</span> Активно сейчас
              </div>
              <div className="status-card-value">
                {summary.runningCount} / {summary.total}
              </div>
              <div className="status-card-sub">
                {(summary.totalCpu / 100).toFixed(1)} из {CONTAINER_CORES} ядер ({summary.totalCpu.toFixed(0)}%) · {summary.totalMem} МБ
              </div>
            </div>
            <div className="status-card" title="Суммарное число строк BookmakerMatch по всем конторам и видам спорта.">
              <div className="status-card-label">
                <span className="msi">database</span> Кэфов в базе
              </div>
              <div className="status-card-value">{summary.totalMatches.toLocaleString("ru-RU")}</div>
              <div className="status-card-sub">суммарно по всем конторам и видам спорта</div>
            </div>
          </div>
        )}

        <select className="st-tab-select" aria-label="Раздел настроек" value={activeTab} onChange={(e) => selectTab(e.target.value as TabKey)}>
          {tabs.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
              {t.dirty ? " •" : ""}
            </option>
          ))}
        </select>
        <nav className="st-tabs" role="tablist" aria-label="Разделы страницы">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={activeTab === t.key}
              className={`st-tab${activeTab === t.key ? " st-tab-active" : ""}`}
              title={t.hint}
              onClick={() => selectTab(t.key)}
            >
              <span className="msi">{t.icon}</span>
              {t.label}
              {t.dirty && <span className="st-tab-dot" title="Есть несохранённые изменения" />}
            </button>
          ))}
        </nav>

        {activeTab === "overview" && (
          <Section
            icon="dns"
            title="Конторы"
            desc="Когда каждая контора обновлялась в последний раз и сколько матчей по видам спорта сейчас в базе. Страница обновляется сама каждые 30 секунд."
            flush
            action={
              perms.sync_force_now ? (
                <button
                  type="button"
                  className={`logs-button st-refresh-btn${refreshState === "done" ? " st-refresh-btn-running" : ""}${refreshState === "finished" ? " st-refresh-btn-finished" : ""}`}
                  onClick={refreshNow}
                  disabled={refreshState !== "idle"}
                  title="Запустить синк топ-6 лиг, хоккея и тенниса прямо сейчас, не дожидаясь обычного расписания"
                >
                  <span className={`msi${refreshState === "triggering" || refreshState === "done" ? " spin" : ""}`}>{refreshState === "finished" ? "check_circle" : "refresh"}</span>
                  {refreshState === "triggering"
                    ? "Запускаю…"
                    : refreshState === "done"
                      ? (() => {
                          const left = Math.max(0, REFRESH_WAIT_SEC - Math.floor((now - refreshStartedAt) / 1000));
                          return left > 0 ? `Обновляю… ещё ~${left} сек` : "Почти готово…";
                        })()
                      : refreshState === "finished"
                        ? "Данные обновлены"
                        : "Обновить сейчас"}
                  {refreshState === "done" && <span key={refreshStartedAt} className="st-refresh-progress" style={{ animationDuration: `${REFRESH_WAIT_SEC}s` }} />}
                </button>
              ) : undefined
            }
          >
            {!data && (
              <div className="st-muted" style={{ padding: 18 }}>
                <Loader label="Загружаю состояние контор…" size={105} />
              </div>
            )}
            {data && (
              <div className="table-wrap" style={{ margin: 0 }}>
                <table className="odds-table st-cards-table">
                  <thead>
                    <tr>
                      <th className="col-league">Контора</th>
                      {data.sports.map((s) => (
                        <th key={s} className="col-bookmaker">
                          {DELETED_SPORT_LABELS[s] ?? s}
                        </th>
                      ))}
                      <th className="col-bookmaker">Последнее обновление</th>
                      <th className="col-bookmaker">Когда</th>
                      <th className="col-bookmaker">Статус</th>
                      <th className="col-bookmaker">Процесс сейчас</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="st-group-row">
                      <td colSpan={columnCount}>
                        <span className="msi st-ico-regular">{GROUP_REGULAR.icon}</span> {GROUP_REGULAR.title}
                      </td>
                    </tr>
                    {regularBookmakers.map((b) => (
                      renderBookmakerRow(b)
                    ))}
                    {cryptoBookmakers.length > 0 && (
                      <tr className="st-group-row">
                        <td colSpan={columnCount}>
                          <span className="msi">{GROUP_CRYPTO.icon}</span> {GROUP_CRYPTO.title}
                        </td>
                      </tr>
                    )}
                    {cryptoBookmakers.map((b) => (
                      renderBookmakerRow(b)
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        )}

        {activeTab === "collect" && (
          <>
            {readOnlyNote}
            <CollectTab draftConfig={draftConfig} editDraft={editDraft} canEdit={canEdit} />
          </>
        )}

        {activeTab === "display" && (
          <>
            {readOnlyNote}
            <DisplayTab draftConfig={draftConfig} editDraft={editDraft} canEdit={canEdit} />
          </>
        )}

        {activeTab === "reports" && <ReportsTab />}

        {activeTab === "proxies" && perms.proxies_view && <ProxiesTab />}
        {activeTab === "live" && perms.live_view && <LiveStatusTab />}
        {activeTab === "deleted" && perms.board_view && <DeletedMatchesTab canRestoreAll={!!perms.match_delete_all} />}

        {activeTab === "tools" && canSeeTools && (
          <Section icon="build" title="Инструменты" desc="Журналы работы и ручная настройка разбора коэффициентов.">
            {perms.sync_view_logs && (
              <>
                <Row icon="terminal" label="Лог синхронизации" desc="Что и когда собирала каждая контора, ошибки и сбои запусков.">
                  <button type="button" className="logs-button" onClick={() => setLogsModal("sync")}>
                    Открыть
                  </button>
                </Row>
                <Row icon="psychology" label="Проверка аномалий (ИИ)" desc="Что ИИ счёл дублем или неправдоподобным коэффициентом и что с этим сделано.">
                  <button type="button" className="logs-button" onClick={() => setLogsModal("anomalies")}>
                    Открыть
                  </button>
                </Row>
              </>
            )}
            {perms.calibration_view && (
              <Row icon="tune" label="Неправильные коэффициенты" desc="Калибровка парсинга: отметьте контору с некорректной лигой или матчем и отправьте ссылку или фото.">
                <button type="button" className="logs-button" onClick={() => setCalibrationOpen(true)}>
                  Открыть
                </button>
              </Row>
            )}
          </Section>
        )}

        {calibrationOpen && perms.calibration_view && <CalibrationModal onClose={() => setCalibrationOpen(false)} perms={perms} />}
      </main>

      {(hasChanges || saveState !== "idle") && (
        <div className="st-save-bar" role="status">
          {saveState === "saved" && !hasChanges ? (
            <span className="st-save-text">
              <span className="msi">check_circle</span> Применено
            </span>
          ) : (
            <>
              <span className="st-save-text">
                <span className="msi">edit_note</span> Есть несохранённые изменения
              </span>
              <button type="button" className="st-save-btn st-save-btn-ghost" onClick={discardDraft} disabled={saveState === "saving"}>
                Отменить
              </button>
              <button
                type="button"
                className="st-save-btn"
                onClick={applyConfig}
                disabled={!hasChanges || saveState === "saving" || !canEdit}
                title={!canEdit ? "Нет права менять общие настройки синхронизации" : "Сохранить и применить: изменения вступят в силу на ближайшем тике синка"}
              >
                {saveState === "saving" ? <Loader inline size={17} /> : <span className="msi">bolt</span>} {saveState === "saving" ? "Сохраняю…" : "Применить"}
              </button>
            </>
          )}
        </div>
      )}

      {logsModal && data && (
        <div className="modal-backdrop" onClick={() => setLogsModal(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Логи синхронизации</div>
              <button type="button" className="modal-close" onClick={() => setLogsModal(null)} aria-label="Закрыть">
                <span className="msi">close</span>
              </button>
            </div>
            <div className="modal-tabs">
              <button type="button" className={`modal-tab${logsModal === "sync" ? " modal-tab-active" : ""}`} onClick={() => setLogsModal("sync")}>
                Синхронизация
              </button>
              <button type="button" className={`modal-tab${logsModal === "anomalies" ? " modal-tab-active" : ""}`} onClick={() => setLogsModal("anomalies")}>
                Аномалии
              </button>
            </div>
            <div className="modal-body">
              <div className="log-box">
                {(logsModal === "sync" ? data.log : data.anomaliesLog).split("\n").map((line, i) => (
                  <div key={i} className={logLineClass(line)}>
                    {line || " "}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <footer className="footer">
        Страница обновляется каждые 30 секунд ·{" "}
        <a href="https://example.com" target="_blank" rel="noreferrer" className="footer-link">
          example.com
        </a>
      </footer>
    </>
  );
}
