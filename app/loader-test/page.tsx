"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { LOADER_ACTIONS, LOADER_SHAPES, type LoaderAction, type LoaderShape } from "../../components/BallsLoader";

// Тестовая страница 3D-лоадера из шариков
const BallsLoader = dynamic(() => import("../../components/BallsLoader"), { ssr: false, loading: () => <div style={{ width: 360, height: 360 }} /> });

const SHAPE_LABELS: Record<LoaderShape, string> = { sphere: "Шар", cube: "Куб", torus: "Тор", helix: "Спираль ДНК", pyramid: "Пирамида", rings: "Гироскоп" };
const ACTION_LABELS: Record<LoaderAction, string> = { scatter: "Рассыпаться", swirl: "Закрутиться", wave: "Волна", pulse: "Пульсация", bookr: "Перемешаться" };

export default function LoaderTestPage() {
  const [shape, setShape] = useState<LoaderShape | "auto">("auto");
  const [action, setAction] = useState<LoaderAction | "auto">("auto");
  const [trigger, setTrigger] = useState(0);

  return (
    <main className="main" style={{ maxWidth: 900, margin: "0 auto", padding: "24px 16px 80px" }}>
      <Link href="/board" className="back-link">
        <span className="msi" style={{ fontSize: 18 }}>arrow_back</span>
        На доску
      </Link>
      <h1 style={{ fontSize: 24, margin: "12px 0 4px" }}>Тест 3D-лоадера из шариков</h1>
      <p className="page-subtitle" style={{ margin: "0 0 16px" }}>
        240 шариков собираются в фигуру, держат её и делают случайное действие, после чего переходят в другую фигуру.
      </p>

      <div style={{ display: "flex", justifyContent: "center", background: "var(--bg-alt)", border: "1px solid var(--border)", borderRadius: 16, padding: 12 }}>
        <BallsLoader size={360} shape={shape} action={action} trigger={trigger} />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", margin: "16px 0" }}>
        <label style={{ fontSize: 14 }}>
          Фигура:{" "}
          <select value={shape} onChange={(e) => setShape(e.target.value as LoaderShape | "auto")}>
            <option value="auto">случайная</option>
            {LOADER_SHAPES.map((s) => (
              <option key={s} value={s}>{SHAPE_LABELS[s]}</option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 14 }}>
          Действие:{" "}
          <select value={action} onChange={(e) => setAction(e.target.value as LoaderAction | "auto")}>
            <option value="auto">случайное</option>
            {LOADER_ACTIONS.map((a) => (
              <option key={a} value={a}>{ACTION_LABELS[a]}</option>
            ))}
          </select>
        </label>
        <button type="button" className="logs-button" onClick={() => setTrigger((t) => t + 1)}>
          <span className="msi">play_arrow</span> Сделать действие сейчас
        </button>
      </div>

      <h2 className="section-heading">Как будет выглядеть в интерфейсе</h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "center" }}>
        <BallsLoader size={96} />
        <BallsLoader size={56} />
        <button type="button" className="logs-button st-refresh-btn st-refresh-btn-running" style={{ minWidth: 260 }} disabled>
          <BallsLoader size={30} />
          Обновляю… ещё ~21 сек
        </button>
      </div>
    </main>
  );
}
