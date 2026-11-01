"use client";

// Калькулятор вилки (surebet)
import { useMemo, useState } from "react";

export interface CalcBookmaker {
  slug: string;
  name: string;
  odds: { "1": number | null; X: number | null; "2": number | null };
}
export interface CalcMatch {
  homeTeam: string;
  awayTeam: string;
  bookmakers: CalcBookmaker[];
}

interface CalcOutcomeSelection {
  bookmakerSlug: string;
  odds: number;
}

const OUTCOME_LABELS: Record<string, string> = { "1": "П1", X: "Х", "2": "П2" };

export default function SurebetCalculatorModal({
  match,
  sportSlug,
  hiddenBookmakers,
  onClose,
}: {
  // null - "пустой" калькулятор без привязки к матчу кнопка рядом с "По лигам"/"Payout")
  match: CalcMatch | null;
  sportSlug: string;
  hiddenBookmakers: Set<string>;
  onClose: () => void;
}) {
  const outcomes = sportSlug === "tennis" ? (["1", "2"] as const) : (["1", "X", "2"] as const);

  const visibleMatchBookmakers = useMemo(
    () => (match ? match.bookmakers.filter((bm) => !hiddenBookmakers.has(bm.slug)) : []),
    [match, hiddenBookmakers]
  );

  const bestByOutcome = useMemo(() => {
    const result: Record<string, CalcOutcomeSelection | null> = {};
    if (!match) {
      for (const o of outcomes) result[o] = null;
      return result;
    }
    for (const o of outcomes) {
      let bestBm: CalcBookmaker | null = null;
      for (const bm of visibleMatchBookmakers) {
        const v = bm.odds[o];
        if (v !== null && (!bestBm || v > (bestBm.odds[o] ?? -Infinity))) bestBm = bm;
      }
      result[o] = bestBm ? { bookmakerSlug: bestBm.slug, odds: bestBm.odds[o]! } : null;
    }
    return result;
  }, [match, outcomes, visibleMatchBookmakers]);

  const [selection, setSelection] = useState<Record<string, CalcOutcomeSelection>>(() => {
    const init: Record<string, CalcOutcomeSelection> = {};
    for (const o of outcomes) init[o] = bestByOutcome[o] ?? { bookmakerSlug: "", odds: 0 };
    return init;
  });
  const [totalStake, setTotalStake] = useState(10000);
  const [lockedOutcome, setLockedOutcome] = useState<string | null>(null);
  const [lockedAmount, setLockedAmount] = useState(10000);

  const missingOutcome = outcomes.some((o) => !selection[o] || selection[o].odds <= 0);

  const stakes = useMemo(() => {
    const result: Record<string, number> = {};
    if (missingOutcome) {
      for (const o of outcomes) result[o] = 0;
      return result;
    }
    if (lockedOutcome && selection[lockedOutcome]) {
      const k = lockedAmount * selection[lockedOutcome].odds;
      for (const o of outcomes) result[o] = o === lockedOutcome ? lockedAmount : k / selection[o].odds;
    } else {
      const invSum = outcomes.reduce((s, o) => s + 1 / selection[o].odds, 0);
      for (const o of outcomes) result[o] = invSum > 0 ? totalStake * (1 / selection[o].odds) / invSum : 0;
    }
    return result;
  }, [selection, outcomes, lockedOutcome, lockedAmount, totalStake, missingOutcome]);

  const totalActual = outcomes.reduce((s, o) => s + stakes[o], 0);
  const profitAbs = totalActual > 0 && !missingOutcome ? stakes[outcomes[0]] * selection[outcomes[0]].odds - totalActual : 0;
  const profitPct = totalActual > 0 ? (profitAbs / totalActual) * 100 : 0;
  const isRealArb = !missingOutcome && profitPct > 0;

  function updateOdds(outcome: string, odds: number) {
    setSelection((prev) => ({ ...prev, [outcome]: { ...prev[outcome], odds } }));
  }
  function updateBookmaker(outcome: string, slug: string) {
    if (!match) return;
    const bm = match.bookmakers.find((b) => b.slug === slug);
    const v = bm?.odds[outcome as "1" | "X" | "2"];
    if (v == null) return;
    setSelection((prev) => ({ ...prev, [outcome]: { bookmakerSlug: slug, odds: v } }));
  }
  function toggleLock(outcome: string) {
    if (lockedOutcome === outcome) {
      setLockedOutcome(null);
      return;
    }
    setLockedAmount(Math.round(stakes[outcome]) || 1000);
    setLockedOutcome(outcome);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box calc-modal-box" role="dialog" aria-modal="true" aria-label="Калькулятор вилки" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <span className="msi" style={{ verticalAlign: "middle", marginRight: 6 }}>
              calculate
            </span>
            {match ? `Вилка: ${match.homeTeam} — ${match.awayTeam}` : "Калькулятор вилки"}
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Закрыть">
            <span className="msi">close</span>
          </button>
        </div>
        <div className="modal-body">
          <table className="calc-table">
            <thead>
              <tr>
                <th>Исход</th>
                {match && <th>Контора</th>}
                <th>Кэф</th>
                <th>Сумма</th>
                <th><span className="sr-only">Зафиксировать</span></th>
                <th>Доход</th>
              </tr>
            </thead>
            <tbody>
              {outcomes.map((o) => {
                const isLocked = lockedOutcome === o;
                const optionsForOutcome = visibleMatchBookmakers.filter((bm) => bm.odds[o] !== null);
                const rowStake = stakes[o];
                const rowProfit = totalActual > 0 && !missingOutcome ? rowStake * selection[o].odds - totalActual : 0;
                return (
                  <tr key={o}>
                    <td className="calc-outcome-label">{OUTCOME_LABELS[o]}</td>
                    {match && (
                      <td data-label="Контора" className="calc-cell-book">
                        <select
                          className="calc-select"
                          aria-label={`Букмекер для исхода ${OUTCOME_LABELS[o]}`}
                          value={selection[o].bookmakerSlug}
                          onChange={(e) => updateBookmaker(o, e.target.value)}
                        >
                          {optionsForOutcome.length === 0 && <option value="">нет кэфа</option>}
                          {optionsForOutcome.map((bm) => (
                            <option key={bm.slug} value={bm.slug}>
                              {bm.name} ({bm.odds[o]!.toFixed(2)})
                            </option>
                          ))}
                        </select>
                      </td>
                    )}
                    <td data-label="Кэф" className="calc-cell-odds">
                      <input
                        type="number"
                        step="0.01"
                        min="1.01"
                        className="calc-input calc-input-odds"
                        aria-label={`Коэффициент: ${OUTCOME_LABELS[o]}`}
                        value={selection[o].odds || ""}
                        onChange={(e) => updateOdds(o, parseFloat(e.target.value) || 0)}
                      />
                    </td>
                    <td data-label="Сумма" className="calc-cell-stake">
                      <input
                        type="number"
                        step="1"
                        className="calc-input"
                        aria-label={`Сумма ставки: ${OUTCOME_LABELS[o]}`}
                        disabled={!isLocked}
                        value={isLocked ? lockedAmount || "" : Math.round(rowStake)}
                        onChange={(e) => setLockedAmount(Number(e.target.value) || 0)}
                      />
                    </td>
                    <td className="calc-cell-lock">
                      <button
                        type="button"
                        className={`calc-lock-btn${isLocked ? " calc-lock-btn-on" : ""}`}
                        onClick={() => toggleLock(o)}
                        title={isLocked ? "Открепить сумму" : "Закрепить эту сумму и пересчитать остальные"}
                        aria-label={isLocked ? "Открепить сумму" : "Закрепить сумму"}
                      >
                        <span className="msi">{isLocked ? "lock" : "lock_open"}</span>
                      </button>
                    </td>
                    <td className={`calc-cell-profit ${rowProfit >= 0 ? "calc-profit-positive" : "calc-profit-negative"}`}>
                      {missingOutcome ? "—" : `${rowProfit >= 0 ? "+" : ""}${rowProfit.toFixed(0)} ₽`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="calc-summary-row">
            <label className="calc-total-label">
              Общая сумма
              <input
                type="number"
                step="1"
                className="calc-input calc-input-total"
                disabled={lockedOutcome !== null}
                // тот же фикс, что и у "Сумма" в таблице выше - see комментарий там
                value={lockedOutcome !== null ? Math.round(totalActual) : totalStake || ""}
                onChange={(e) => setTotalStake(Number(e.target.value) || 0)}
              />
              ₽
            </label>
            <div className={`calc-verdict${isRealArb ? " calc-verdict-good" : " calc-verdict-bad"}`}>
              {missingOutcome
                ? "У части исходов нет кэфа - вилку посчитать нельзя"
                : isRealArb
                  ? `Вилка есть: доход ${profitPct.toFixed(2)}% при любом исходе`
                  : `Дохода нет (${profitPct.toFixed(2)}%) - это не вилка при текущих кэфах`}
            </div>
          </div>

          {lockedOutcome && (
            <div className="calc-hint">
              Сумма на «{OUTCOME_LABELS[lockedOutcome]}» закреплена - остальные пересчитаны так, чтобы доход был
              одинаковым при любом исходе. Откройте замочек, чтобы вернуться к распределению по общей сумме.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
