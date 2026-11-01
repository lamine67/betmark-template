"use client";

// Калькулятор вилки (боковая панель /forks)
import { useEffect, useMemo, useState } from "react";
import {
  calculate,
  linkInfo,
  openLegs,
  copyMatchName,
  fmtMoney,
  netPrice,
  OUTCOME_LABEL,
  SPORT_LABELS,
  type ForkRow,
  type ForkSettings,
  type MatchMeta,
} from "@/lib/forks/model";

interface Props {
  fork: ForkRow;
  meta: MatchMeta | undefined;
  settings: ForkSettings;
  rates: Record<string, number>;
  names: Record<string, string>;
  onClose: () => void;
  onSaved: () => void;
}

export default function ForkCalculator({ fork, meta, settings, rates, names, onClose, onSaved }: Props) {
  const [prices, setPrices] = useState<number[]>(() => fork.legs.map((l) => l.price));
  const [mode, setMode] = useState<"total" | "fixed">("total");
  const [total, setTotal] = useState<number>(settings.calc.defaultTotal);
  const [fixedIndex, setFixedIndex] = useState(0);
  const [fixedAmount, setFixedAmount] = useState<number>(1000);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [priceDrift, setPriceDrift] = useState<string | null>(null);

  // выбор конторы для ноги среди клонов с той же ценой (если в основной нет счёта или она порезана)
  const [choice, setChoice] = useState<number[]>(() => fork.legs.map(() => 0));
  const legs = useMemo(
    () =>
      fork.legs.map((l, i) => {
        const opts = [l, ...(l.alts ?? []).map((a) => ({ ...l, ...a, alts: [] }))];
        return opts[Math.min(choice[i] ?? 0, opts.length - 1)];
      }),
    [fork.legs, choice]
  );

  // новая вилка выбрана - сбрасываем ручные правки
  useEffect(() => {
    setPrices(fork.legs.map((l) => l.price));
    setChoice(fork.legs.map(() => 0));
    setSaved(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fork.id]);

  // сканер обновил цены, пока панель открыта - предупреждаем, не перетирая ручные правки
  useEffect(() => {
    const changed = fork.legs.some((l, i) => Math.abs(l.price - (prices[i] ?? l.price)) > 1e-9);
    setPriceDrift(changed ? "Цены в сканере изменились: " + fork.legs.map((l) => `${names[l.slug] ?? l.slug} ${l.price}`).join(", ") : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fork.legs.map((l) => l.price).join("|")]);

  const totalRub = useMemo(() => {
    const cur = settings.calc.totalCurrency || "RUB";
    if (cur === "RUB") return total;
    const r = settings.calc.rateMode === "manual" && settings.calc.manualRates[cur] > 0 ? settings.calc.manualRates[cur] : rates[cur];
    return r > 0 ? total * r : total;
  }, [total, settings.calc, rates]);

  const res = useMemo(
    () =>
      calculate(
        legs.map((l, i) => ({ slug: l.slug, outcome: l.outcome, price: prices[i] > 1 ? prices[i] : l.price })),
        settings,
        rates,
        mode,
        totalRub,
        fixedIndex,
        fixedAmount
      ),
    [legs, prices, settings, rates, mode, totalRub, fixedIndex, fixedAmount]
  );

  const title = meta ? `${meta.home} — ${meta.away}` : fork.matchId;
  const [openNote, setOpenNote] = useState<string | null>(null);
  const openAll = () => setOpenNote(openLegs(legs, fork.sport, meta, settings, names) || null);

  async function saveBet() {
    setSaving(true);
    setSaved(null);
    try {
      const r = await fetch("/api/forks/bets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          forkId: fork.id,
          kind: fork.kind,
          matchId: fork.matchId,
          sport: fork.sport,
          market: fork.market,
          line: fork.line,
          title,
          league: meta?.league ?? "",
          kickoffAt: meta?.kickoffAt ?? null,
          expectedProfit: Math.round(res.minProfitRub * 100) / 100,
          note,
          legs: res.legs.map((l) => ({ slug: l.slug, outcome: l.outcome, price: l.price, stake: l.stake, currency: l.currency, stakeRub: Math.round(l.stakeRub * 100) / 100, net: l.net })),
        }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      setSaved("Записано в журнал ставок");
      onSaved();
    } catch (e) {
      setSaved("Не удалось записать: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside className="fk-calc">
      <div className="fk-calc-head">
        <div>
          <div className="fk-calc-title">{title}</div>
          <div className="fk-calc-sub">
            {SPORT_LABELS[fork.sport] ?? fork.sport} · {meta?.league ?? ""} · {fork.kind === "live" ? "Live" : "Прематч"}
          </div>
        </div>
        <button type="button" className="fk-icon-btn" onClick={onClose} aria-label="Закрыть калькулятор" title="Закрыть">
          <span className="msi">close</span>
        </button>
      </div>

      <div className="fk-seg">
        <button type="button" className={mode === "total" ? "on" : ""} onClick={() => setMode("total")}>
          Общая сумма
        </button>
        <button type="button" className={mode === "fixed" ? "on" : ""} onClick={() => setMode("fixed")}>
          Фиксированная ставка
        </button>
      </div>

      {mode === "total" ? (
        <label className="fk-field">
          <span>Общая сумма ({settings.calc.totalCurrency || "RUB"})</span>
          <input type="number" min={0} step={100} value={total || ""} onChange={(e) => setTotal(Number(e.target.value) || 0)} />
        </label>
      ) : (
        <div className="fk-field-row">
          <label className="fk-field">
            <span>Нога</span>
            <select value={fixedIndex} onChange={(e) => setFixedIndex(Number(e.target.value))}>
              {legs.map((l, i) => (
                <option key={i} value={i}>
                  {OUTCOME_LABEL[l.outcome] ?? l.outcome} · {names[l.slug] ?? l.slug}
                </option>
              ))}
            </select>
          </label>
          <label className="fk-field">
            <span>Ставка ({res.legs[fixedIndex]?.currency ?? "RUB"})</span>
            <input type="number" min={0} step={10} value={fixedAmount || ""} onChange={(e) => setFixedAmount(Number(e.target.value) || 0)} />
          </label>
        </div>
      )}

      <div className="fk-calc-legs">
        {res.legs.map((l, i) => {
          const leg = legs[i];
          const orig = fork.legs[i];
          const opts = [orig.slug, ...(orig.alts ?? []).map((a) => a.slug)];
          return (
            <div className="fk-calc-leg" key={i}>
              <div className="fk-calc-leg-top">
                <span className="fk-out">{OUTCOME_LABEL[l.outcome] ?? l.outcome}</span>
                {opts.length > 1 ? (
                  <select
                    className="fk-calc-bk-select"
                    value={choice[i] ?? 0}
                    title="Та же цена есть у нескольких контор - выберите, где ставить"
                    onChange={(e) => setChoice((c) => c.map((x, j) => (j === i ? Number(e.target.value) : x)))}
                  >
                    {opts.map((s, k) => (
                      <option key={s} value={k}>
                        {names[s] ?? s}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="fk-calc-bk">{names[l.slug] ?? l.slug}</span>
                )}
                {(() => {
                  const li = linkInfo(l.slug, leg, fork.sport, meta, settings);
                  return (
                    <a
                      className={`fk-link${li.exact ? "" : " section"}`}
                      href={li.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={li.exact ? "Открыть матч в конторе" : "Прямой ссылки на матч нет: откроется раздел конторы, название команды скопируется в буфер"}
                      onClick={() => {
                        if (!li.exact) setOpenNote(`${names[l.slug] ?? l.slug}: прямой ссылки на матч нет - открыт раздел конторы, название команды «${copyMatchName(meta)}» скопировано, вставьте его в поиск.`);
                      }}
                    >
                      <span className="msi">{li.exact ? "open_in_new" : "search"}</span>
                    </a>
                  );
                })()}
              </div>
              <div className="fk-calc-leg-grid">
                <label>
                  <span>Кэф</span>
                  <input
                    type="number"
                    step="0.01"
                    min="1.01"
                    value={prices[i] || ""}
                    onChange={(e) => setPrices((p) => p.map((x, j) => (j === i ? Number(e.target.value) || 0 : x)))}
                  />
                </label>
                <div>
                  <span>Ставка</span>
                  <b>{fmtMoney(l.stake, l.currency)}</b>
                  {l.currency !== "RUB" && <em>≈ {fmtMoney(l.stakeRub)}</em>}
                </div>
                <div>
                  <span>Выплата</span>
                  <b>{fmtMoney(l.payoutRub)}</b>
                  {l.net !== l.price && <em>чистый кэф {l.net.toFixed(3)}</em>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className={`fk-calc-sum ${res.minProfitRub >= 0 ? "pos" : "neg"}`}>
        <div>
          <span>Всего поставлено</span>
          <b>{fmtMoney(res.totalRub)}</b>
        </div>
        <div>
          <span>Доход при любом исходе</span>
          <b>
            {res.minProfitRub >= 0 ? "+" : ""}
            {fmtMoney(res.minProfitRub)} ({res.minProfitPct.toFixed(2)}%)
          </b>
        </div>
        {Math.abs(res.maxProfitRub - res.minProfitRub) >= 1 && (
          <div>
            <span>Лучший исход</span>
            <b>+{fmtMoney(res.maxProfitRub)}</b>
          </div>
        )}
        <div className="fk-calc-note">Без округления: {res.theoreticalPct.toFixed(2)}%. Округление и валюты меняют итог - он показан выше.</div>
      </div>

      {legs.some((l) => netPrice(l.slug, l.price, settings) !== l.price) && (
        <div className="fk-calc-hint">Для биржи учтена комиссия с выигрыша (настройки → Биржи).</div>
      )}
      {res.warning && <div className="fk-warn">{res.warning}</div>}
      {priceDrift && <div className="fk-warn">{priceDrift}</div>}
      {openNote && <div className="fk-warn">{openNote}</div>}

      <div className="fk-calc-actions">
        <button type="button" className="fk-btn" onClick={openAll} title="Если открылась только одна вкладка - разрешите всплывающие окна для example.com">
          <span className="msi">open_in_new</span>Открыть все конторы
        </button>
        <button type="button" className="fk-btn fk-btn-primary" disabled={saving || res.totalRub <= 0} onClick={saveBet}>
          <span className="msi">bookmark_add</span>Записать в журнал
        </button>
      </div>
      <label className="fk-field">
        <span>Заметка к ставке</span>
        <input type="text" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Необязательно" />
      </label>
      {saved && <div className="fk-calc-saved">{saved}</div>}
      <div className="fk-calc-hint">Перед ставкой сверяйте коэффициент в купоне конторы: если он изменился, поправьте кэф выше - суммы пересчитаются.</div>
    </aside>
  );
}
