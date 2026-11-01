// Звук новой вилки - синтез через WebAudio (без файлов)
let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(c: AudioContext, freq: number, start: number, dur: number, vol: number, type: OscillatorType = "sine") {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, c.currentTime + start);
  g.gain.linearRampToValueAtTime(vol, c.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + start);
  o.stop(c.currentTime + start + dur + 0.02);
}

export function playForkSound(kind: "beep" | "chime" | "double" | "alarm", volume: number) {
  const c = ac();
  if (!c) return;
  const v = Math.max(0, Math.min(1, volume)) * 0.4;
  if (kind === "beep") tone(c, 880, 0, 0.18, v, "square");
  else if (kind === "double") {
    tone(c, 988, 0, 0.12, v);
    tone(c, 988, 0.18, 0.12, v);
  } else if (kind === "alarm") {
    for (let i = 0; i < 3; i++) tone(c, i % 2 ? 660 : 990, i * 0.15, 0.14, v, "sawtooth");
  } else {
    tone(c, 784, 0, 0.25, v);
    tone(c, 1175, 0.12, 0.35, v);
  }
}

export function unlockAudio() {
  ac();
}
