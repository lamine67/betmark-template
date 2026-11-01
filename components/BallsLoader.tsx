"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

export type LoaderShape = "sphere" | "cube" | "torus" | "helix" | "pyramid" | "rings";
export type LoaderAction = "scatter" | "swirl" | "wave" | "pulse" | "bookr";
export const LOADER_SHAPES: LoaderShape[] = ["sphere", "cube", "torus", "helix", "pyramid", "rings"];
export const LOADER_ACTIONS: LoaderAction[] = ["scatter", "swirl", "wave", "pulse", "bookr"];

const FULL_N = 240; // обычный лоадер
const LITE_N = 70; // для маленьких размеров (<= 64px): меньше шариков, но крупнее - иначе превращается в мутное облачко
const HOLD_SEC = 2.2; // сколько держим фигуру
const ACTION_SEC = 2.0; // сколько длится действие (на середине фигура меняется)

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function halton(index: number, base: number): number {
  let f = 1;
  let r = 0;
  let i = index;
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

function buildShape(shape: LoaderShape, n: number): Float32Array {
  const out = new Float32Array(n * 3);
  const set = (i: number, x: number, y: number, z: number) => {
    out[i * 3] = x;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = z;
  };
  for (let i = 0; i < n; i++) {
    if (shape === "sphere") {
      const y = 1 - ((i + 0.5) / n) * 2;
      const r = Math.sqrt(1 - y * y);
      const th = i * 2.399963;
      set(i, Math.cos(th) * r * 1.3, y * 1.3, Math.sin(th) * r * 1.3);
    } else if (shape === "cube") {
      const f = i % 6;
      const u = halton(i + 1, 2) * 2 - 1;
      const v = halton(i + 1, 3) * 2 - 1;
      const s = 1.05;
      const pts: [number, number, number][] = [
        [s, u * s, v * s], [-s, u * s, v * s], [u * s, s, v * s], [u * s, -s, v * s], [u * s, v * s, s], [u * s, v * s, -s],
      ];
      set(i, ...pts[f]);
    } else if (shape === "torus") {
      const u = halton(i + 1, 2) * Math.PI * 2;
      const v = halton(i + 1, 3) * Math.PI * 2;
      const R = 1.0;
      const r = 0.46;
      const x = (R + r * Math.cos(v)) * Math.cos(u);
      const y0 = r * Math.sin(v);
      const z0 = (R + r * Math.cos(v)) * Math.sin(u);
      const tilt = 0.55; // наклон, чтобы тор был виден не с ребра
      set(i, x, y0 * Math.cos(tilt) - z0 * Math.sin(tilt), y0 * Math.sin(tilt) + z0 * Math.cos(tilt));
    } else if (shape === "helix") {
      const strand = i % 2;
      const t = (i >> 1) / (n / 2);
      const ang = t * Math.PI * 6 + strand * Math.PI;
      set(i, Math.cos(ang) * 0.72, (t - 0.5) * 3.0, Math.sin(ang) * 0.72);
    } else if (shape === "pyramid") {
      if (i % 5 === 0) {
        set(i, (halton(i + 1, 2) * 2 - 1) * 1.1, -1.0, (halton(i + 1, 3) * 2 - 1) * 1.1);
      } else {
        const k = i % 4;
        const corners: [number, number][] = [[-1.1, -1.1], [1.1, -1.1], [1.1, 1.1], [-1.1, 1.1]];
        const a = corners[k];
        const b = corners[(k + 1) % 4];
        let u = halton(i + 1, 2);
        let v = halton(i + 1, 3);
        if (u + v > 1) {
          u = 1 - u;
          v = 1 - v;
        }
        // точка внутри треугольника (вершина, a, b)
        const w = 1 - u - v;
        set(i, w * 0 + u * a[0] + v * b[0], w * 1.3 + (u + v) * -1.0, w * 0 + u * a[1] + v * b[1]);
      }
    } else {
      // rings - три взаимно перпендикулярных кольца (гироскоп)
      const k = i % 3;
      const ang = (Math.floor(i / 3) / (n / 3)) * Math.PI * 2;
      const R = 1.3;
      const c = Math.cos(ang) * R;
      const s = Math.sin(ang) * R;
      if (k === 0) set(i, c, s, 0);
      else if (k === 1) set(i, 0, c, s);
      else set(i, c, 0, s);
    }
  }
  return out;
}

interface Sim {
  mode: "hold" | "action";
  t: number;
  time: number;
  action: LoaderAction;
  shape: LoaderShape;
  nextShape: LoaderShape;
  perm: Uint16Array;
  switched: boolean;
  rotY: number;
  lastTrigger: number;
}

function Balls({ shape, action, trigger, still, n, ballScale }: { shape: LoaderShape | "auto"; action: LoaderAction | "auto"; trigger: number; still: boolean; n: number; ballScale: number }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const group = useRef<THREE.Group>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const data = useMemo(() => {
    const rnd = mulberry32(20261008);
    const shapes = Object.fromEntries(LOADER_SHAPES.map((s) => [s, buildShape(s, n)])) as Record<LoaderShape, Float32Array>;
    const pos = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    const dir = new Float32Array(n * 3);
    const stiff = new Float32Array(n);
    const radius = new Float32Array(n);
    const phase = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      // старт: шарики разбросаны вокруг и "слетаются" в первую фигуру
      const th = rnd() * Math.PI * 2;
      const ph = Math.acos(2 * rnd() - 1);
      const r0 = 1.6 + rnd() * 0.7;
      pos[i * 3] = Math.sin(ph) * Math.cos(th) * r0;
      pos[i * 3 + 1] = Math.cos(ph) * r0;
      pos[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * r0;
      const th2 = rnd() * Math.PI * 2;
      const ph2 = Math.acos(2 * rnd() - 1);
      dir[i * 3] = Math.sin(ph2) * Math.cos(th2);
      dir[i * 3 + 1] = Math.cos(ph2);
      dir[i * 3 + 2] = Math.sin(ph2) * Math.sin(th2);
      stiff[i] = 34 * (0.75 + rnd() * 0.55);
      radius[i] = 0.07 * (0.8 + rnd() * 0.55);
      phase[i] = rnd() * Math.PI * 2;
    }
    return { shapes, pos, vel, dir, stiff, radius, phase };
  }, [n]);

  const sim = useRef<Sim>({
    mode: "hold",
    t: 0,
    time: 0,
    action: "scatter",
    shape: "sphere",
    nextShape: "cube",
    perm: Uint16Array.from({ length: n }, (_, i) => i),
    switched: false,
    rotY: 0,
    lastTrigger: trigger,
  });

  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const l = 0.42 + 0.3 * ((i * 0.61803398875) % 1);
      c.setHSL(0, 0, l);
      m.setColorAt(i, c);
    }
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, []);

  useFrame((_, rawDt) => {
    const m = mesh.current;
    const g = group.current;
    if (!m || !g) return;
    const dt = Math.min(rawDt, 0.05);
    const s = sim.current;
    s.time += dt;
    s.t += dt;

    const pickOther = <T,>(list: T[], not: T): T => {
      const rest = list.filter((x) => x !== not);
      return rest[Math.floor(Math.random() * rest.length)];
    };
    const startAction = () => {
      s.mode = "action";
      s.t = 0;
      s.switched = false;
      s.action = action === "auto" ? LOADER_ACTIONS[Math.floor(Math.random() * LOADER_ACTIONS.length)] : action;
      s.nextShape = shape === "auto" ? pickOther(LOADER_SHAPES, s.shape) : shape;
    };

    if (!still) {
      if (trigger !== s.lastTrigger && s.mode === "hold") {
        s.lastTrigger = trigger;
        startAction();
      } else if (s.mode === "hold" && s.t > HOLD_SEC) {
        startAction();
      }
    }

    let env = 0;
    if (s.mode === "action") {
      const p = s.t / ACTION_SEC;
      env = Math.sin(Math.PI * Math.min(p, 1));
      if (!s.switched && p >= 0.5) {
        s.shape = s.nextShape;
        s.switched = true;
        const arr = Array.from({ length: n }, (_, i) => i);
        for (let i = n - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        s.perm = Uint16Array.from(arr);
      }
      if (p >= 1) {
        s.mode = "hold";
        s.t = 0;
        env = 0;
      }
    }

    const swirl = s.mode === "action" && s.action === "swirl";
    s.rotY += dt * (0.5 + (swirl ? 7 * env : 0.7 * env));
    g.rotation.y = s.rotY;
    g.rotation.x = 0.22 * Math.sin(s.time * 0.55);

    const target = data.shapes[s.shape];
    // первые 2,4 с (вход в первую фигуру) - критическое затухание: шарики подплывают без пролёта и колебаний
    const damp = Math.exp(-(s.time < 2.4 ? 34 : 15) * dt);
    const act = s.mode === "action" ? s.action : null;
    for (let i = 0; i < n; i++) {
      const k = s.perm[i] * 3;
      let x = target[k];
      let y = target[k + 1];
      let z = target[k + 2];
      // лёгкое "дыхание" шариков в покое
      const ph = data.phase[i];
      x += Math.sin(s.time * 1.3 + ph) * 0.03;
      y += Math.cos(s.time * 1.1 + ph * 1.7) * 0.03;
      z += Math.sin(s.time * 0.9 + ph * 0.6) * 0.03;
      if (act === "scatter") {
        x += data.dir[i * 3] * env * 1.05;
        y += data.dir[i * 3 + 1] * env * 1.05;
        z += data.dir[i * 3 + 2] * env * 1.05;
      } else if (act === "wave") {
        y += Math.sin(x * 2.6 + s.time * 9) * 0.42 * env;
      } else if (act === "pulse") {
        const sc = 1 + 0.45 * env * Math.sin(s.time * 14);
        x *= sc;
        y *= sc;
        z *= sc;
      } else if (act === "swirl") {
        const a = 3.5 * env * y;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const nx = x * ca - z * sa;
        z = x * sa + z * ca;
        x = nx;
      } else if (act === "bookr") {
        x += data.dir[i * 3] * env * 0.7;
        y += data.dir[i * 3 + 1] * env * 0.7;
        z += data.dir[i * 3 + 2] * env * 0.7;
      }
      const ax = (x - data.pos[i * 3]) * data.stiff[i] * dt;
      const ay = (y - data.pos[i * 3 + 1]) * data.stiff[i] * dt;
      const az = (z - data.pos[i * 3 + 2]) * data.stiff[i] * dt;
      data.vel[i * 3] = (data.vel[i * 3] + ax) * damp;
      data.vel[i * 3 + 1] = (data.vel[i * 3 + 1] + ay) * damp;
      data.vel[i * 3 + 2] = (data.vel[i * 3 + 2] + az) * damp;
      data.pos[i * 3] += data.vel[i * 3] * dt * 6;
      data.pos[i * 3 + 1] += data.vel[i * 3 + 1] * dt * 6;
      data.pos[i * 3 + 2] += data.vel[i * 3 + 2] * dt * 6;
      dummy.position.set(data.pos[i * 3], data.pos[i * 3 + 1], data.pos[i * 3 + 2]);
      dummy.scale.setScalar(data.radius[i] * ballScale * (1 + 0.18 * Math.sin(s.time * 3 + ph)));
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });

  return (
    <group ref={group}>
      <instancedMesh ref={mesh} args={[undefined, undefined, n]} frustumCulled={false}>
        <sphereGeometry args={[1, 14, 10]} />
        <meshStandardMaterial roughness={0.32} metalness={0.15} />
      </instancedMesh>
    </group>
  );
}

export default function BallsLoader({
  size = 220,
  shape = "auto",
  action = "auto",
  trigger = 0,
  lite = false,
  className,
}: {
  size?: number;
  shape?: LoaderShape | "auto";
  action?: LoaderAction | "auto";
  trigger?: number;
  lite?: boolean;
  className?: string;
}) {
  const still = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  return (
    <div className={className} style={{ width: size, height: size, display: "inline-block", lineHeight: 0 }} role="status" aria-label="Загрузка">
      <Canvas dpr={[1, 2]} camera={{ position: [0, 0, 6.6], fov: 38 }} gl={{ antialias: true, alpha: true }} style={{ width: size, height: size }}>
        <ambientLight intensity={1.05} />
        <directionalLight position={[3, 4, 5]} intensity={1.7} />
        <pointLight position={[-3, -1.5, 3]} intensity={26} color="#ffffff" />
        <Balls shape={shape} action={action} trigger={trigger} still={!!still} n={lite ? LITE_N : FULL_N} ballScale={lite ? 2.1 : 1} />
      </Canvas>
    </div>
  );
}
