"use client";

import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { ContactShadows } from "@react-three/drei";
import SoccerBall from "./SoccerBall";

// Камера здесь НАМЕРЕННО фиксированная, без адаптации под aspect - история этого файла
export default function HeroScene({
  reduceMotion,
  pointer,
  scrollProgress,
}: {
  reduceMotion: boolean;
  pointer: React.RefObject<{ x: number; y: number }>;
  scrollProgress: React.RefObject<number>;
}) {
  const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio, 2) : 1;

  return (
    <Canvas
      dpr={dpr}
      camera={{ position: [0, 0.4, 4.2], fov: 38 }}
      gl={{ antialias: true, alpha: true }}
      shadows
    >
      <Suspense fallback={null}>
        {/* Классическая 3-точечная продуктовая схема света - тёплый key, холодный fill, rim для контура силуэта мяча */}
        <directionalLight position={[3, 4, 2]} intensity={2.6} color="#fff4e0" castShadow shadow-mapSize={[1024, 1024]} />
        <directionalLight position={[-3, 1, -2]} intensity={0.7} color="#8ab4ff" />
        <directionalLight position={[0, 1.5, -3.5]} intensity={1.4} color="#7CFFB2" />
        <ambientLight intensity={0.55} />

        <SoccerBall reduceMotion={reduceMotion} pointer={pointer} scrollProgress={scrollProgress} />

        <ContactShadows position={[0, -1.25, 0]} opacity={0.45} scale={6} blur={2.4} far={2} color="#001a0f" />
      </Suspense>
    </Canvas>
  );
}
