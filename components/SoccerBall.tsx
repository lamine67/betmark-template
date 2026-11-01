"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

// Настоящая модель мяча вместо процедурного усечённого икосаэдра
useGLTF.preload("/football-ball.glb");

// Материалы Blender-сцены ("White"/"Black") сделаны через Mix Shader (Diffuse+Glossy), а не Principled BSDF
const PANEL_COLORS: Record<string, string> = {
  White: "#f2efe6",
  Black: "#141414",
  Wire: "#101010",
};

function panelMaterial(name: string): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: PANEL_COLORS[name] ?? "#cccccc",
    roughness: name === "Black" ? 0.6 : 0.5,
    clearcoat: 0.35,
    clearcoatRoughness: 0.4,
    envMapIntensity: 0.9,
  });
}

// Модель приходит произвольного размера/со смещённым центром
function useNormalizedBallScene(targetDiameter: number) {
  const { scene } = useGLTF("/football-ball.glb");
  return useMemo(() => {
    const raw = scene.clone(true);
    raw.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const mat = mesh.material;
      if (Array.isArray(mat)) {
        mesh.material = mat.map((m) => panelMaterial(m.name));
      } else if (mat) {
        mesh.material = panelMaterial((mat as THREE.Material).name);
      }
    });
    const box = new THREE.Box3().setFromObject(raw);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);
    raw.position.sub(center);

    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const wrapper = new THREE.Group();
    wrapper.add(raw);
    wrapper.scale.setScalar(targetDiameter / maxDim);
    return wrapper;
  }, [scene, targetDiameter]);
}

// easeOutBack - лёгкий "перелёт" в конце (мяч чуть переигрывает масштаб и оседает обратно)
function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

// Плавный, без перелёта, для самого перемещения (x/z)
function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - x, 3);
}

const INTRO_DURATION = 1.4;

export default function SoccerBall({
  reduceMotion,
  pointer,
  scrollProgress,
}: {
  reduceMotion: boolean;
  pointer: React.RefObject<{ x: number; y: number }>;
  scrollProgress: React.RefObject<number>;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const ballRef = useRef<THREE.Group>(null);
  const ballScene = useNormalizedBallScene(1.9);

  useFrame((state, delta) => {
    if (!groupRef.current || !ballRef.current) return;
    const t = state.clock.elapsedTime;

    // Появление: мяч влетает СБОКУ и ИЗДАЛЕКА по дуге
    const flightT = reduceMotion ? 1 : Math.min(1, t / INTRO_DURATION);
    const flightEase = easeOutCubic(flightT);
    const landEase = easeOutBack(flightT);
    const introX = reduceMotion ? 0 : THREE.MathUtils.lerp(6, 0, flightEase);
    const introZ = reduceMotion ? 0 : THREE.MathUtils.lerp(-4.2, 0, flightEase);
    const introArcY = reduceMotion ? 0 : 4 * 0.95 * flightEase * (1 - flightEase);
    const introSpin = reduceMotion ? 0 : (1 - flightEase) * Math.PI * 2.4;

    if (!reduceMotion) {
      // Idle: медленное собственное вращение мяча по двум осям
      ballRef.current.rotation.y += delta * 0.18;
      ballRef.current.rotation.x += delta * 0.05;
      // Во время влёта добавляем быстрое доп. вращение, гасящееся к концу
      ballRef.current.rotation.x += introSpin * delta * 2;
      ballRef.current.rotation.z = introSpin * 0.4;

      // Лёгкое покачивание всей группы по высоте
      const idleT = Math.max(0, t - INTRO_DURATION);
      const idleBob = flightT >= 1 ? Math.sin(idleT * 0.6) * 0.12 : 0;
      groupRef.current.position.y = idleBob + introArcY;

      // Параллакс-наклон вслед за курсором (ограниченный угол)
      const px = pointer.current?.x ?? 0;
      const py = pointer.current?.y ?? 0;
      groupRef.current.rotation.y += (px * 0.35 - groupRef.current.rotation.y) * 0.06;
      groupRef.current.rotation.x += (-py * 0.2 - groupRef.current.rotation.x) * 0.06;
    }

    // Скролл двигает мяч чуть вправо и уменьшает по мере прокрутки hero-секции - привязано к прогрессу скролла, не к времени
    const sp = scrollProgress.current ?? 0;
    // Отзывчивость к пропорциям экрана сделана ЗДЕСЬ (масштаб самого мяча), а не через камеру
    const aspect = state.size.width / state.size.height;
    const responsiveScale = THREE.MathUtils.clamp(aspect / 1.6, 0.55, 1);
    const scrollScale = (1 - sp * 0.35) * responsiveScale;
    // Масштаб во время влёта растёт от "далёкого" 0.65 до полного размера с лёгким перелётом (easeOutBack)
    const introScale = THREE.MathUtils.lerp(0.65, 1, landEase);
    const targetScale = flightT < 1 ? scrollScale * introScale : scrollScale;
    if (flightT < 1) {
      // Во время влёта ставим масштаб и позицию напрямую (не lerp) - иначе сглаживание съедает резкость дуги и посадки
      groupRef.current.scale.setScalar(Math.max(0, targetScale));
      groupRef.current.position.x = introX;
      groupRef.current.position.z = introZ;
    } else {
      groupRef.current.scale.setScalar(THREE.MathUtils.lerp(groupRef.current.scale.x, targetScale, 0.1));
      groupRef.current.position.x = THREE.MathUtils.lerp(groupRef.current.position.x, sp * 1.4, 0.1);
      groupRef.current.position.z = THREE.MathUtils.lerp(groupRef.current.position.z, 0, 0.1);
    }
  });

  // у <group> НЕ задаём scale через JSX-проп (было scale={0})
  return (
    <group ref={groupRef}>
      <primitive ref={ballRef} object={ballScene} />
    </group>
  );
}
