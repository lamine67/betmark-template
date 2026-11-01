"use client";

// Настройки сканера вилок: фильтры (несколько одновременно), правила по конторам, сортировка, отображение
import { useState } from "react";
import { playForkSound } from "./sound";
import {
  CURRENCIES,
  DEFAULT_LINKS,
  EXCHANGE_SLUGS,
  SORT_LABELS,
  SPORT_LABELS,
  defaultSettings,
  newFilter,
  pairKey,
  type BookmakerRule,
  type ForkFilter,
  type ForkKind,
  type ForkSettings,
  type SortKey,
} from "@/lib/forks/model";

interface Props {
  settings: ForkSettings;
  onChange: (s: ForkSettings) => void;
  names: Record<string, string>;
  rates: Record<string, number>;
  ratesDate: string | null;
}

type Section = "filters" | "sort" | "display" | "calc" | "exchange" | "sound" | "links";
const SECTIONS: [Section, string, string][] = [
  ["filters", "Фильтры", "filter_alt"],
  ["sort", "Сортировка", "sort"],
  ["display", "Отображение", "view_list"],
  ["calc", "Калькулятор и валюты", "calculate"],
  ["exchange", "Биржи", "currency_exchange"],
  ["sound", "Звук", "notifications_active"],
  ["links", "Ссылки в конторы", "link"],
];

const numOrNull = (v: string): number | null => (v.trim() === "" || Number.isNaN(Number(v)) ? null : Number(v));

function NumField({ label, value, onChange, step = 1, placeholder, hint }: { label: string; value: number | null; onChange: (v: number | null) => void; step?: number; placeholder?: string; hint?: string }) {
  return (
    <label className="fk-field" title={hint}>
      <span>{label}</span>
      <input type="number" step={step} value={value ?? ""} placeholder={placeholder ?? "не важно"} onChange={(e) => onChange(numOrNull(e.target.value))} />
    </label>
  );
}

function Chips<T extends string | number>({ options, value, onChange, labels }: { options: T[]; value: T[]; onChange: (v: T[]) => void; labels?: Record<string, string> }) {
  return (
    <div className="fk-chips">
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button type="button" key={String(o)} className={`fk-chip${on ? " on" : ""}`} onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}>
            {on && <span className="msi">check</span>}
            {labels?.[String(o)] ?? String(o)}
          </button>
        );
      })}
    </div>
  );
}

function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="fk-toggle" title={hint}>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export default function ForkSettingsPanel({ settings, onChange, names, rates, ratesDate }: Props) {
  const [section, setSection] = useState<Section>("filters");
  const [filterId, setFilterId] = useState<string>(settings.filters[0]?.id ?? "");
  const [pairA, setPairA] = useState("");
  const [pairB, setPairB] = useState("");
  const slugs = Object.keys(names).sort((a, b) => (names[a] ?? a).localeCompare(names[b] ?? b, "ru"));
  const flt = settings.filters.find((f) => f.id === filterId) ?? settings.filters[0];
  const set = (patch: Partial<ForkSettings>) => onChange({ ...settings, ...patch });
  const setFilter = (patch: Partial<ForkFilter>) => set({ filters: settings.filters.map((f) => (f.id === flt.id ? { ...f, ...patch } : f)) });
  const setRule = (slug: string, patch: Partial<BookmakerRule> | null) => {
    const cur = flt.perBookmaker[slug] ?? { sports: [], oddsMin: null, oddsMax: null, maxOverPct: null, onlyTop: false, disabled: false };
    const next = { ...flt.perBookmaker };
    if (patch === null) delete next[slug];
    else next[slug] = { ...cur, ...patch };
    setFilter({ perBookmaker: next });
  };
  const bkLabels = Object.fromEntries(slugs.map((s) => [s, names[s] ?? s]));

  return (
    <div className="fk-settings">
      <nav className="fk-settings-nav">
        {SECTIONS.map(([id, label, icon]) => (
          <button type="button" key={id} className={section === id ? "on" : ""} onClick={() => setSection(id)}>
            <span className="msi">{icon}</span>
            {label}
          </button>
        ))}
        <button
          type="button"
          className="fk-settings-reset"
          onClick={() => {
            if (confirm("Сбросить ВСЕ настройки сканера к значениям по умолчанию?")) {
              const d = defaultSettings();
              onChange(d);
              setFilterId(d.filters[0].id);
            }
          }}
        >
          <span className="msi">restart_alt</span>Сбросить всё
        </button>
      </nav>

      <div className="fk-settings-body">
        {section === "filters" && flt && (
          <>
            <div className="fk-sec-head">
              <h3>Фильтры</h3>
              <p>Вилка показывается, если подходит хотя бы под один включённый фильтр. У каждого фильтра свои условия - например, отдельный для Live и отдельный для прематча.</p>
            </div>
            <div className="fk-filter-tabs">
              {settings.filters.map((f) => (
                <div key={f.id} className={`fk-filter-tab${f.id === flt.id ? " on" : ""}`}>
                  <input type="checkbox" checked={f.enabled} title="Включён" onChange={(e) => set({ filters: settings.filters.map((x) => (x.id === f.id ? { ...x, enabled: e.target.checked } : x)) })} />
                  <button type="button" onClick={() => setFilterId(f.id)}>
                    {f.name || "Без названия"}
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="fk-btn"
                onClick={() => {
                  const f = newFilter(`Фильтр ${settings.filters.length + 1}`);
                  set({ filters: [...settings.filters, f] });
                  setFilterId(f.id);
                }}
              >
                <span className="msi">add</span>Новый
              </button>
              <button
                type="button"
                className="fk-btn"
                onClick={() => {
                  const f = { ...JSON.parse(JSON.stringify(flt)), id: Math.random().toString(36).slice(2, 10), name: flt.name + " (копия)" };
                  set({ filters: [...settings.filters, f] });
                  setFilterId(f.id);
                }}
              >
                <span className="msi">content_copy</span>Копия
              </button>
              {settings.filters.length > 1 && (
                <button
                  type="button"
                  className="fk-btn fk-btn-danger"
                  onClick={() => {
                    if (!confirm(`Удалить фильтр «${flt.name}»?`)) return;
                    const rest = settings.filters.filter((f) => f.id !== flt.id);
                    set({ filters: rest });
                    setFilterId(rest[0].id);
                  }}
                >
                  <span className="msi">delete</span>Удалить
                </button>
              )}
            </div>

            <div className="fk-card">
              <h4>Основное</h4>
              <label className="fk-field">
                <span>Название фильтра</span>
                <input type="text" value={flt.name} maxLength={60} onChange={(e) => setFilter({ name: e.target.value })} />
              </label>
              <div className="fk-row-fields">
                <div>
                  <div className="fk-label">Где действует</div>
                  <Chips<ForkKind> options={["prematch", "live"]} value={flt.kinds} onChange={(v) => setFilter({ kinds: v })} labels={{ prematch: "Прематч", live: "Live" }} />
                </div>
                <div>
                  <div className="fk-label">Виды спорта (ничего не выбрано = все)</div>
                  <Chips options={["football", "hockey", "tennis"]} value={flt.sports} onChange={(v) => setFilter({ sports: v })} labels={SPORT_LABELS} />
                </div>
                <div>
                  <div className="fk-label">Число исходов вилки</div>
                  <Chips<number> options={[2, 3]} value={flt.outcomes} onChange={(v) => setFilter({ outcomes: v })} labels={{ "2": "2 исхода", "3": "3 исхода" }} />
                </div>
              </div>
            </div>

            <div className="fk-card">
              <h4>Доход и ROI</h4>
              <div className="fk-grid4">
                <NumField label="Доход от, %" step={0.1} value={flt.minProfit} placeholder="0" onChange={(v) => setFilter({ minProfit: v ?? 0 })} hint="Можно отрицательный - до −3% в прематче и −4% в Live" />
                <NumField label="Доход до, %" step={0.1} value={flt.maxProfit} onChange={(v) => setFilter({ maxProfit: v })} hint="Слишком большие вилки почти всегда ошибка линии" />
                <NumField label="ROI от, % годовых" step={1} value={flt.minRoi} onChange={(v) => setFilter({ minRoi: v })} hint="Доход, растянутый на год с учётом того, сколько часов деньги заморожены до расчёта" />
                <NumField label="ROI до, % годовых" step={1} value={flt.maxRoi} onChange={(v) => setFilter({ maxRoi: v })} />
              </div>
            </div>

            <div className="fk-card">
              <h4>Время</h4>
              <div className="fk-grid4">
                <NumField label="До начала от, мин (прематч)" value={flt.startFromMin} onChange={(v) => setFilter({ startFromMin: v })} />
                <NumField label="До начала до, мин (прематч)" value={flt.startToMin} onChange={(v) => setFilter({ startToMin: v })} />
                <NumField label="Минута Live от" value={flt.liveMinuteFrom} onChange={(v) => setFilter({ liveMinuteFrom: v })} />
                <NumField label="Минута Live до" value={flt.liveMinuteTo} onChange={(v) => setFilter({ liveMinuteTo: v })} />
                <NumField label="Время жизни вилки от, с" value={flt.lifetimeFromSec} onChange={(v) => setFilter({ lifetimeFromSec: v })} hint="Например, 10 - не показывать только что появившиеся вилки" />
                <NumField label="Время жизни вилки до, с" value={flt.lifetimeToSec} onChange={(v) => setFilter({ lifetimeToSec: v })} hint="Например, 600 - скрывать «залежавшиеся» вилки" />
                <NumField label="Цены прематча не старше, с" value={flt.maxPriceAgePrematchSec} onChange={(v) => setFilter({ maxPriceAgePrematchSec: v })} hint="Сколько секунд назад контору последний раз опрашивали. По умолчанию 1200 (20 минут): более старые цены могли уйти" />
                <NumField label="Цены Live не старше, с" value={flt.maxPriceAgeLiveSec} onChange={(v) => setFilter({ maxPriceAgeLiveSec: v })} hint="Для Live разумно 15-30 секунд" />
              </div>
            </div>

            <div className="fk-card">
              <h4>Коэффициенты и ошибки линий</h4>
              <div className="fk-grid4">
                <NumField label="Кэф от" step={0.01} value={flt.oddsMin} onChange={(v) => setFilter({ oddsMin: v })} />
                <NumField label="Кэф до" step={0.01} value={flt.oddsMax} onChange={(v) => setFilter({ oddsMax: v })} />
                <NumField label="Завышенность не больше, %" step={1} value={flt.maxOverPct} onChange={(v) => setFilter({ maxOverPct: v })} hint="Насколько кэф ноги выше среднего у остальных контор" />
                <NumField label="«Явная ошибка» от, %" step={1} value={flt.errorOverPct} placeholder="30" onChange={(v) => setFilter({ errorOverPct: v ?? 30 })} />
              </div>
              <Toggle label="Скрывать явные ошибки линии (завышенность выше порога)" value={flt.hideErrors} onChange={(v) => setFilter({ hideErrors: v })} />
              <div className="fk-label">Биржи в вилке</div>
              <div className="fk-seg fk-seg-inline">
                {(["any", "only", "none"] as const).map((m) => (
                  <button type="button" key={m} className={flt.exchangeMode === m ? "on" : ""} onClick={() => setFilter({ exchangeMode: m })}>
                    {m === "any" ? "Не важно" : m === "only" ? "Только с биржей" : "Без бирж"}
                  </button>
                ))}
              </div>
            </div>

            <div className="fk-card">
              <h4>Лиги и турниры</h4>
              <div className="fk-row-fields">
                <Toggle label="Топ-лиги" value={flt.leagues.top} onChange={(v) => setFilter({ leagues: { ...flt.leagues, top: v } })} />
                <Toggle label="Вторые / третьи лиги" value={flt.leagues.second} onChange={(v) => setFilter({ leagues: { ...flt.leagues, second: v } })} />
                <Toggle label="Остальные лиги" value={flt.leagues.other} onChange={(v) => setFilter({ leagues: { ...flt.leagues, other: v } })} />
                <Toggle label="Женские" value={flt.leagues.women} onChange={(v) => setFilter({ leagues: { ...flt.leagues, women: v } })} />
                <Toggle label="Молодёжные и резерв" value={flt.leagues.youth} onChange={(v) => setFilter({ leagues: { ...flt.leagues, youth: v } })} />
              </div>
              <div className="fk-grid3">
                <label className="fk-field">
                  <span>Только лиги (через запятую, часть названия)</span>
                  <input type="text" value={flt.leagueInclude} placeholder="например: Англия, КХЛ" onChange={(e) => setFilter({ leagueInclude: e.target.value })} />
                </label>
                <label className="fk-field">
                  <span>Исключить лиги</span>
                  <input type="text" value={flt.leagueExclude} placeholder="например: Кубок, товарищ" onChange={(e) => setFilter({ leagueExclude: e.target.value })} />
                </label>
                <label className="fk-field">
                  <span>Команды (через запятую)</span>
                  <input type="text" value={flt.teamSearch} placeholder="поиск по названию команды" onChange={(e) => setFilter({ teamSearch: e.target.value })} />
                </label>
              </div>
            </div>

            <div className="fk-card">
              <h4>Конторы</h4>
              <div className="fk-label">Разрешённые конторы (ничего не выбрано = все)</div>
              <Chips options={slugs} value={flt.bookmakers} onChange={(v) => setFilter({ bookmakers: v })} labels={bkLabels} />
              <div className="fk-label">Вилка обязательно должна включать одну из контор</div>
              <Chips options={slugs} value={flt.requiredBookmakers} onChange={(v) => setFilter({ requiredBookmakers: v })} labels={bkLabels} />
              <div className="fk-label">Исключённые связки контор</div>
              <div className="fk-pair-add">
                <select value={pairA} onChange={(e) => setPairA(e.target.value)}>
                  <option value="">контора…</option>
                  {slugs.map((s) => (
                    <option key={s} value={s}>
                      {names[s] ?? s}
                    </option>
                  ))}
                </select>
                <span>+</span>
                <select value={pairB} onChange={(e) => setPairB(e.target.value)}>
                  <option value="">контора…</option>
                  {slugs.map((s) => (
                    <option key={s} value={s}>
                      {names[s] ?? s}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="fk-btn"
                  disabled={!pairA || !pairB || pairA === pairB}
                  onClick={() => {
                    const k = pairKey([pairA, pairB]);
                    if (!flt.excludedPairs.includes(k)) setFilter({ excludedPairs: [...flt.excludedPairs, k] });
                  }}
                >
                  <span className="msi">add</span>Исключить связку
                </button>
              </div>
              <div className="fk-chips">
                {flt.excludedPairs.map((p) => (
                  <span className="fk-chip on" key={p}>
                    {p
                      .split("+")
                      .map((s) => names[s] ?? s)
                      .join(" + ")}
                    <button type="button" className="fk-chip-x" onClick={() => setFilter({ excludedPairs: flt.excludedPairs.filter((x) => x !== p) })} aria-label="Убрать">
                      <span className="msi">close</span>
                    </button>
                  </span>
                ))}
                {!flt.excludedPairs.length && <span className="fk-muted">нет</span>}
              </div>
            </div>

            <div className="fk-card">
              <h4>Индивидуально по конторам</h4>
              <p className="fk-muted">Правило конторы действует на ноги этой конторы в любой вилке этого фильтра.</p>
              <div className="fk-bk-rules">
                <div className="fk-bk-rule fk-bk-rule-head">
                  <span>Контора</span>
                  <span>Выключить</span>
                  <span>Виды спорта</span>
                  <span>Кэф от</span>
                  <span>Кэф до</span>
                  <span>Завыш. до, %</span>
                  <span>Только топ</span>
                  <span />
                </div>
                {slugs.map((s) => {
                  const r = flt.perBookmaker[s];
                  return (
                    <div className={`fk-bk-rule${r ? " set" : ""}`} key={s}>
                      <span>{names[s] ?? s}</span>
                      <input type="checkbox" checked={!!r?.disabled} onChange={(e) => setRule(s, { disabled: e.target.checked })} />
                      <Chips options={["football", "hockey", "tennis"]} value={r?.sports ?? []} onChange={(v) => setRule(s, { sports: v })} labels={{ football: "Ф", hockey: "Х", tennis: "Т" }} />
                      <input type="number" step="0.01" value={r?.oddsMin ?? ""} onChange={(e) => setRule(s, { oddsMin: numOrNull(e.target.value) })} />
                      <input type="number" step="0.01" value={r?.oddsMax ?? ""} onChange={(e) => setRule(s, { oddsMax: numOrNull(e.target.value) })} />
                      <input type="number" step="1" value={r?.maxOverPct ?? ""} onChange={(e) => setRule(s, { maxOverPct: numOrNull(e.target.value) })} />
                      <input type="checkbox" checked={!!r?.onlyTop} onChange={(e) => setRule(s, { onlyTop: e.target.checked })} />
                      {r ? (
                        <button type="button" className="fk-icon-btn" title="Сбросить правило" onClick={() => setRule(s, null)}>
                          <span className="msi">backspace</span>
                        </button>
                      ) : (
                        <span />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {section === "sort" && (
          <>
            <div className="fk-sec-head">
              <h3>Сортировка</h3>
              <p>Порядок вилок задаётся несколькими уровнями: сначала по первому, при равенстве - по второму и т.д. Совпадает с сортировкой по клику на заголовки в списке.</p>
            </div>
            <div className="fk-card">
              {settings.sort.map((lvl, i) => (
                <div className="fk-sort-row" key={i}>
                  <span className="fk-sort-n">{i + 1}</span>
                  <select value={lvl.key} onChange={(e) => set({ sort: settings.sort.map((x, j) => (j === i ? { ...x, key: e.target.value as SortKey } : x)) })}>
                    {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                      <option key={k} value={k}>
                        {SORT_LABELS[k]}
                      </option>
                    ))}
                  </select>
                  <div className="fk-seg fk-seg-inline">
                    <button type="button" className={lvl.dir === "desc" ? "on" : ""} onClick={() => set({ sort: settings.sort.map((x, j) => (j === i ? { ...x, dir: "desc" } : x)) })}>
                      по убыванию
                    </button>
                    <button type="button" className={lvl.dir === "asc" ? "on" : ""} onClick={() => set({ sort: settings.sort.map((x, j) => (j === i ? { ...x, dir: "asc" } : x)) })}>
                      по возрастанию
                    </button>
                  </div>
                  <button type="button" className="fk-icon-btn" disabled={i === 0} title="Выше" onClick={() => { const a = [...settings.sort]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; set({ sort: a }); }}>
                    <span className="msi">arrow_upward</span>
                  </button>
                  <button type="button" className="fk-icon-btn" disabled={i === settings.sort.length - 1} title="Ниже" onClick={() => { const a = [...settings.sort]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; set({ sort: a }); }}>
                    <span className="msi">arrow_downward</span>
                  </button>
                  <button type="button" className="fk-icon-btn" disabled={settings.sort.length === 1} title="Убрать уровень" onClick={() => set({ sort: settings.sort.filter((_, j) => j !== i) })}>
                    <span className="msi">close</span>
                  </button>
                </div>
              ))}
              <button type="button" className="fk-btn" disabled={settings.sort.length >= 5} onClick={() => set({ sort: [...settings.sort, { key: "start", dir: "asc" }] })}>
                <span className="msi">add</span>Добавить уровень
              </button>
              <div className="fk-presets">
                <span className="fk-label">Быстрые варианты:</span>
                <button type="button" className="fk-chip" onClick={() => set({ sort: [{ key: "profit", dir: "desc" }, { key: "age", dir: "asc" }] })}>Самые доходные</button>
                <button type="button" className="fk-chip" onClick={() => set({ sort: [{ key: "age", dir: "asc" }, { key: "profit", dir: "desc" }] })}>Самые свежие</button>
                <button type="button" className="fk-chip" onClick={() => set({ sort: [{ key: "start", dir: "asc" }, { key: "profit", dir: "desc" }] })}>Ближайшие матчи</button>
                <button type="button" className="fk-chip" onClick={() => set({ sort: [{ key: "roi", dir: "desc" }] })}>Лучший ROI</button>
                <button type="button" className="fk-chip" onClick={() => set({ sort: [{ key: "overMax", dir: "asc" }, { key: "profit", dir: "desc" }] })}>Надёжные (меньше завышенность)</button>
              </div>
            </div>
          </>
        )}

        {section === "display" && (
          <>
            <div className="fk-sec-head">
              <h3>Отображение</h3>
              <p>Как выглядит список вилок.</p>
            </div>
            <div className="fk-card">
              <div className="fk-grid3">
                <label className="fk-field">
                  <span>Плотность списка</span>
                  <select value={settings.display.density} onChange={(e) => set({ display: { ...settings.display, density: e.target.value as "compact" | "normal" } })}>
                    <option value="normal">Обычная</option>
                    <option value="compact">Компактная</option>
                  </select>
                </label>
                <label className="fk-field">
                  <span>Доход считать</span>
                  <select value={settings.display.profitBasis} onChange={(e) => set({ display: { ...settings.display, profitBasis: e.target.value as "net" | "gross" } })}>
                    <option value="net">с учётом комиссии бирж</option>
                    <option value="gross">по кэфам «как есть»</option>
                  </select>
                </label>
                <NumField label="Обновлять список раз в, с" value={settings.refreshSec} onChange={(v) => set({ refreshSec: Math.min(60, Math.max(2, v ?? 3)) })} />
                <NumField label="Сколько матчей показывать" value={settings.display.maxGroups} onChange={(v) => set({ display: { ...settings.display, maxGroups: Math.max(10, v ?? 200) } })} />
                <NumField label="Подсвечивать новые вилки, с" value={settings.display.highlightNewSec} onChange={(v) => set({ display: { ...settings.display, highlightNewSec: Math.max(0, v ?? 20) } })} />
              </div>
              <div className="fk-row-fields">
                <Toggle label="Группировать вилки по матчу" value={settings.groupByMatch} onChange={(v) => set({ groupByMatch: v })} />
                <Toggle label="Колонка ROI" value={settings.display.showRoi} onChange={(v) => set({ display: { ...settings.display, showRoi: v } })} />
                <Toggle label="Время жизни вилки" value={settings.display.showAge} onChange={(v) => set({ display: { ...settings.display, showAge: v } })} />
                <Toggle label="Завышенность кэфа" value={settings.display.showOverPct} onChange={(v) => set({ display: { ...settings.display, showOverPct: v } })} />
                <Toggle label="Возраст цены у ноги" value={settings.display.showPriceAge} onChange={(v) => set({ display: { ...settings.display, showPriceAge: v } })} />
                <Toggle label="Кэфы всех контор матча (раскрываются по клику на матч)" value={settings.display.showAllQuotes} onChange={(v) => set({ display: { ...settings.display, showAllQuotes: v } })} />
                <Toggle label="Максимальный доход за жизнь" value={settings.display.showMaxProfit} onChange={(v) => set({ display: { ...settings.display, showMaxProfit: v } })} />
                <Toggle label="Названия сработавших фильтров" value={settings.display.showFilterTags} onChange={(v) => set({ display: { ...settings.display, showFilterTags: v } })} />
              </div>
            </div>
          </>
        )}

        {section === "calc" && (
          <>
            <div className="fk-sec-head">
              <h3>Калькулятор и валюты</h3>
              <p>Общая сумма задаётся в выбранной валюте, ставка каждой конторы считается в валюте её счёта и округляется по её шагу.</p>
            </div>
            <div className="fk-card">
              <div className="fk-grid4">
                <NumField label="Сумма по умолчанию" step={100} value={settings.calc.defaultTotal} onChange={(v) => set({ calc: { ...settings.calc, defaultTotal: Math.max(0, v ?? 10000) } })} />
                <label className="fk-field">
                  <span>Валюта общей суммы</span>
                  <select value={settings.calc.totalCurrency} onChange={(e) => set({ calc: { ...settings.calc, totalCurrency: e.target.value } })}>
                    {CURRENCIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label className="fk-field">
                  <span>Округление ставок</span>
                  <select value={settings.calc.roundMode} onChange={(e) => set({ calc: { ...settings.calc, roundMode: e.target.value as "nearest" | "down" } })}>
                    <option value="nearest">до ближайшего шага</option>
                    <option value="down">всегда вниз</option>
                  </select>
                </label>
                <NumField label="Шаг округления (рубли)" value={settings.calc.defaultRound} onChange={(v) => set({ calc: { ...settings.calc, defaultRound: Math.max(0, v ?? 10) } })} />
              </div>
            </div>
            <div className="fk-card">
              <h4>По конторам</h4>
              <div className="fk-bk-calc">
                <div className="fk-bk-calc-row fk-bk-rule-head">
                  <span>Контора</span>
                  <span>Валюта счёта</span>
                  <span>Шаг округления</span>
                  <span>Макс. ставка (в валюте)</span>
                </div>
                {slugs.map((s) => (
                  <div className="fk-bk-calc-row" key={s}>
                    <span>{names[s] ?? s}</span>
                    <select value={settings.calc.currency[s] ?? "RUB"} onChange={(e) => set({ calc: { ...settings.calc, currency: { ...settings.calc.currency, [s]: e.target.value } } })}>
                      {CURRENCIES.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      step="0.01"
                      placeholder={(settings.calc.currency[s] ?? "RUB") === "RUB" ? String(settings.calc.defaultRound) : "0.01"}
                      value={settings.calc.roundTo[s] ?? ""}
                      onChange={(e) => {
                        const v = numOrNull(e.target.value);
                        const next = { ...settings.calc.roundTo };
                        if (v == null) delete next[s];
                        else next[s] = v;
                        set({ calc: { ...settings.calc, roundTo: next } });
                      }}
                    />
                    <input
                      type="number"
                      step="1"
                      placeholder="без лимита"
                      value={settings.calc.maxStake[s] ?? ""}
                      onChange={(e) => {
                        const v = numOrNull(e.target.value);
                        const next = { ...settings.calc.maxStake };
                        if (v == null || v <= 0) delete next[s];
                        else next[s] = v;
                        set({ calc: { ...settings.calc, maxStake: next } });
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="fk-card">
              <h4>Курсы валют</h4>
              <div className="fk-seg fk-seg-inline">
                <button type="button" className={settings.calc.rateMode === "cbr" ? "on" : ""} onClick={() => set({ calc: { ...settings.calc, rateMode: "cbr" } })}>
                  Курс ЦБ РФ (автоматически)
                </button>
                <button type="button" className={settings.calc.rateMode === "manual" ? "on" : ""} onClick={() => set({ calc: { ...settings.calc, rateMode: "manual" } })}>
                  Свои курсы
                </button>
              </div>
              <p className="fk-muted">ЦБ на {ratesDate ? new Date(ratesDate).toLocaleDateString("ru-RU") : "—"}. USDT считается равным доллару. Свой курс используется, если задан, или если ЦБ не отдал валюту.</p>
              <div className="fk-grid4">
                {CURRENCIES.filter((c) => c !== "RUB").map((c) => (
                  <label className="fk-field" key={c}>
                    <span>
                      1 {c} = ₽ (ЦБ: {rates[c] ? rates[c].toFixed(2) : "—"})
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      value={settings.calc.manualRates[c] ?? ""}
                      placeholder="свой курс"
                      onChange={(e) => {
                        const v = numOrNull(e.target.value);
                        const next = { ...settings.calc.manualRates };
                        if (v == null || v <= 0) delete next[c];
                        else next[c] = v;
                        set({ calc: { ...settings.calc, manualRates: next } });
                      }}
                    />
                  </label>
                ))}
              </div>
            </div>
          </>
        )}

        {section === "exchange" && (
          <>
            <div className="fk-sec-head">
              <h3>Биржи</h3>
              <p>Биржа берёт комиссию с чистого выигрыша. Чистый кэф = 1 + (кэф − 1) × (1 − комиссия). С учётом комиссии вилка с биржей выглядит честнее.</p>
            </div>
            <div className="fk-card">
              <Toggle label="Учитывать комиссию бирж в доходе вилки и калькуляторе" value={settings.exchange.applyCommission} onChange={(v) => set({ exchange: { ...settings.exchange, applyCommission: v } })} />
              <div className="fk-grid4">
                {[...EXCHANGE_SLUGS].map((s) => (
                  <NumField
                    key={s}
                    label={`${names[s] ?? s}: комиссия, %`}
                    step={0.1}
                    value={settings.exchange.commissionPct[s] ?? 0}
                    onChange={(v) => set({ exchange: { ...settings.exchange, commissionPct: { ...settings.exchange.commissionPct, [s]: Math.max(0, Math.min(20, v ?? 0)) } } })}
                    hint="Стандарт Book J - 2% (Pro 1%, Select 3%)"
                  />
                ))}
              </div>
            </div>
          </>
        )}

        {section === "sound" && (
          <>
            <div className="fk-sec-head">
              <h3>Звук</h3>
              <p>Сигнал при появлении новой вилки, которая проходит фильтры и не ниже порога. Звук включается после первого клика по странице (так требует браузер).</p>
            </div>
            <div className="fk-card">
              <Toggle label="Звук новой вилки" value={settings.sound.enabled} onChange={(v) => set({ sound: { ...settings.sound, enabled: v } })} />
              <div className="fk-grid4">
                <NumField label="Только вилки от, %" step={0.1} value={settings.sound.minProfit} onChange={(v) => set({ sound: { ...settings.sound, minProfit: v ?? 0 } })} />
                <label className="fk-field">
                  <span>Мелодия</span>
                  <select value={settings.sound.tone} onChange={(e) => set({ sound: { ...settings.sound, tone: e.target.value as ForkSettings["sound"]["tone"] } })}>
                    <option value="chime">Колокольчик</option>
                    <option value="beep">Короткий писк</option>
                    <option value="double">Двойной сигнал</option>
                    <option value="alarm">Тревога</option>
                  </select>
                </label>
                <label className="fk-field">
                  <span>Громкость: {Math.round(settings.sound.volume * 100)}%</span>
                  <input type="range" min={0} max={1} step={0.05} value={settings.sound.volume} onChange={(e) => set({ sound: { ...settings.sound, volume: Number(e.target.value) } })} />
                </label>
                <div className="fk-field">
                  <span>&nbsp;</span>
                  <button type="button" className="fk-btn" onClick={() => playForkSound(settings.sound.tone, settings.sound.volume)}>
                    <span className="msi">volume_up</span>Проверить
                  </button>
                </div>
              </div>
              <div className="fk-label">Для каких вилок</div>
              <Chips<ForkKind> options={["prematch", "live"]} value={settings.sound.kinds} onChange={(v) => set({ sound: { ...settings.sound, kinds: v } })} labels={{ prematch: "Прематч", live: "Live" }} />
            </div>
          </>
        )}

        {section === "links" && (
          <>
            <div className="fk-sec-head">
              <h3>Ссылки в конторы</h3>
              <p>
                Куда ведёт кнопка перехода. Переменные: <code>{"{url}"}</code> - ссылка на матч из Betmark, <code>{"{url|запасной адрес}"}</code> - если ссылки на матч нет,{" "}
                <code>{"{path}"}</code> - путь ссылки (для зеркал: <code>{"https://example.com"}</code>), <code>{"{externalId}"}</code> - номер события у конторы,{" "}
                <code>{"{home}"}</code>, <code>{"{away}"}</code>, <code>{"{sportRu}"}</code>, <code>{"{sportEn}"}</code>. Пустое поле - вариант по умолчанию.
              </p>
            </div>
            <div className="fk-card">
              {slugs.map((s) => (
                <label className="fk-link-row" key={s}>
                  <span>{names[s] ?? s}</span>
                  <input
                    type="text"
                    value={settings.links[s] ?? ""}
                    placeholder={DEFAULT_LINKS[s] ?? "{url}"}
                    onChange={(e) => {
                      const next = { ...settings.links };
                      if (!e.target.value.trim()) delete next[s];
                      else next[s] = e.target.value;
                      set({ links: next });
                    }}
                  />
                </label>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
