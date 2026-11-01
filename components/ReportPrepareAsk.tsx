"use client";

export default function ReportPrepareAsk({
  count,
  busy,
  err,
  onAnswer,
  onBack,
}: {
  count: number;
  busy: boolean;
  err: string | null;
  onAnswer: (prepare: boolean) => void;
  onBack: () => void;
}) {
  return (
    <div className="modal-backdrop modal-backdrop-top" onClick={busy ? undefined : onBack}>
      <div className="modal-box report-picker" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Вы будете часто менять этот выбор?</span>
          <button type="button" className="modal-close" onClick={onBack} disabled={busy} aria-label="Назад">
            <span className="msi">close</span>
          </button>
        </div>
        <div className="report-picker-body">
          <div style={{ fontSize: 15, lineHeight: 1.5 }}>В вашем наборе {count} контор. Как готовить отчёты по нему?</div>
          <div className="report-picker-note">
            <b>Нет, набор постоянный.</b> Сервер сам будет готовить отчёты по вашему набору для всех будущих матчей: они откроются мгновенно, без ожидания.
          </div>
          <div className="report-picker-note">
            <b>Да, часто меняю.</b> Заранее ничего не готовим: отчёт соберётся при первом скачивании (около 10 секунд), а дальше будет открываться сразу.
          </div>
          {err && (
            <div className="live-error" style={{ marginTop: 10 }}>
              {err}
            </div>
          )}
        </div>
        <div className="report-picker-actions">
          <button type="button" className="logs-button" disabled={busy} onClick={() => onAnswer(true)}>
            <span className="msi">bolt</span>
            Нет, набор постоянный: готовить заранее
          </button>
          <button type="button" className="logs-button" disabled={busy} onClick={() => onAnswer(false)}>
            Да, часто меняю: ничего не готовить
          </button>
        </div>
      </div>
    </div>
  );
}
