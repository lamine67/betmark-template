"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

// Единый индикатор загрузки сайта 3D-шарики (components/BallsLoader.tsx) вместо текста "Загрузка…" и вращающихся
const BallsLoader = dynamic(() => import("./BallsLoader"), { ssr: false, loading: () => null });

// общий реестр лоадеров: кто сейчас "главный"
interface Entry {
  id: number;
  size: number;
  visible: boolean;
}
const entries = new Map<number, Entry>();
const listeners = new Set<() => void>();
let nextId = 1;
let winnerId = 0;

function recompute() {
  let best: Entry | null = null;
  for (const e of entries.values()) {
    if (e.visible && (!best || e.size > best.size)) best = e;
  }
  const next = best ? best.id : 0;
  if (next !== winnerId) {
    winnerId = next;
    listeners.forEach((l) => l());
  }
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const getWinner = () => winnerId;
const getServerWinner = () => 0;

let webglChecked: boolean | null = null;
function webglAvailable(): boolean {
  if (webglChecked !== null) return webglChecked;
  try {
    const c = document.createElement("canvas");
    webglChecked = !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    webglChecked = false;
  }
  return webglChecked;
}

export default function Loader({
  label,
  size,
  inline = false,
  className,
}: {
  label?: string;
  size?: number;
  inline?: boolean;
  className?: string;
}) {
  const px = size ?? (inline ? 24 : 150);
  const idRef = useRef(0);
  if (idRef.current === 0) idRef.current = nextId++;
  const id = idRef.current;
  const boxDiv = useRef<HTMLDivElement>(null);
  const boxSpan = useRef<HTMLSpanElement>(null);
  const [mode, setMode] = useState<"fallback" | "3d">("fallback");
  const winner = useSyncExternalStore(subscribe, getWinner, getServerWinner);
  const isMain = winner === id;

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    setMode(!reduce && webglAvailable() ? "3d" : "fallback");
  }, []);

  // регистрация в общем реестре (размер учитывается при выборе главного)
  useEffect(() => {
    entries.set(id, { id, size: px, visible: true });
    recompute();
    return () => {
      entries.delete(id);
      recompute();
    };
  }, [id, px]);

  // видимость на экране: элемент-маркер остаётся в разметке и у неглавного лоадера, поэтому слежение не прерывается
  useEffect(() => {
    const el = boxDiv.current ?? boxSpan.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (list) => {
        const e = entries.get(id);
        if (e) {
          e.visible = list[list.length - 1]?.isIntersecting ?? true;
          recompute();
        }
      },
      { rootMargin: "100px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [id]);

  const content = !isMain ? null : mode === "3d" ? (
    <BallsLoader size={px} lite={px <= 64} />
  ) : (
    <span className="msi spin ball-loader-fallback" style={{ fontSize: Math.max(16, Math.round(px * 0.5)) }}>
      progress_activity
    </span>
  );

  if (inline) {
    return (
      <span
        ref={boxSpan}
        className={`ball-loader-inline${className ? " " + className : ""}`}
        style={isMain ? { width: px, height: px } : { width: 0, height: 0, margin: 0 }}
        role={isMain ? "status" : undefined}
        aria-label={isMain ? label ?? "Загрузка" : undefined}
        aria-hidden={isMain ? undefined : true}
      >
        {content}
      </span>
    );
  }
  return (
    <div className={`ball-loader-block${className ? " " + className : ""}`} style={isMain ? undefined : { padding: 0 }} role={isMain ? "status" : undefined} aria-live={isMain ? "polite" : undefined}>
      <div ref={boxDiv} className="ball-loader-stage" style={{ width: px, height: isMain ? px : 1 }}>
        {content}
      </div>
      {isMain && label && <div className="ball-loader-label">{label}</div>}
    </div>
  );
}
