// Timer de descanso: contagem regressiva, aviso sonoro e tela ligada durante o treino
export const REST_VERSION = '0.4.1';
let audio = null;

/** Precisa ser chamado dentro de um toque do usuário (exigência do iOS para liberar o som). */
export function unlockAudio() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'transient'; } catch { /* */ }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!audio) audio = new AC();
  if (audio.state === 'suspended') audio.resume();
  // buffer silencioso para "destravar" o áudio no Safari
  const b = audio.createBuffer(1, 1, 22050);
  const s = audio.createBufferSource();
  s.buffer = b; s.connect(audio.destination); s.start(0);
}

/** 3 bipes curtos (o último mais longo). */
export function beep() {
  if (!audio) return;
  if (audio.state === 'suspended') audio.resume();
  const t0 = audio.currentTime + 0.05;
  [0, 0.35, 0.7].forEach((dt, i) => {
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = 'sine';
    o.frequency.value = i === 2 ? 1175 : 880;
    const dur = i === 2 ? 0.45 : 0.18;
    g.gain.setValueAtTime(0.0001, t0 + dt);
    g.gain.exponentialRampToValueAtTime(0.6, t0 + dt + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + dur);
    o.connect(g).connect(audio.destination);
    o.start(t0 + dt);
    o.stop(t0 + dt + dur + 0.05);
  });
  try { navigator.vibrate?.([200, 100, 200]); } catch { /* iPhone não suporta */ }
}

// ---------- Wake Lock (mantém a tela acesa) ----------
let lock = null, wantLock = false;
export async function keepAwake(on) {
  wantLock = on;
  try {
    if (on && !lock && 'wakeLock' in navigator) {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { lock = null; });
    } else if (!on && lock) {
      await lock.release();
      lock = null;
    }
  } catch { lock = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wantLock && !lock) keepAwake(true);
});

export const fmtClock = (s) => {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// ---------- Sons extras ----------
function tone(freq, start, dur, { type = 'sine', gain = 0.5 } = {}) {
  const o = audio.createOscillator();
  const g = audio.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(audio.destination);
  o.start(start);
  o.stop(start + dur + 0.05);
}
const ready = () => { if (!audio) return false; if (audio.state === 'suspended') audio.resume(); return true; };

/** Arpejo ascendente para recorde. */
export function prBeep() {
  if (!ready()) return;
  const t = audio.currentTime + 0.05;
  [784, 988, 1175, 1568].forEach((f, i) => tone(f, t + i * 0.11, i === 3 ? 0.5 : 0.16, { gain: 0.45 }));
}

/** Sino de ringue (parciais inarmônicas), repetido `times` vezes. */
export function bell(times = 1) {
  if (!ready()) return;
  const t0 = audio.currentTime + 0.05;
  for (let k = 0; k < times; k++) {
    const t = t0 + k * 0.45;
    [[830, 0.5, 1.6], [2290, 0.25, 0.9], [3410, 0.12, 0.6], [4980, 0.06, 0.4]].forEach(([f, gn, d]) => tone(f, t, d, { gain: gn }));
  }
}

/** Gongo grave e longo (fim do round). */
export function gong() {
  if (!ready()) return;
  const t = audio.currentTime + 0.05;
  [[180, 0.6, 3.2], [270, 0.35, 2.6], [496, 0.25, 2.0], [745, 0.15, 1.4], [1100, 0.08, 0.9]].forEach(([f, gn, d]) => tone(f, t, d, { gain: gn }));
  bell(3);
}

/** Aviso de "faltam X segundos": 3 batidas secas. */
export function warnClap() {
  if (!ready()) return;
  const t = audio.currentTime + 0.05;
  for (let i = 0; i < 3; i++) tone(1500, t + i * 0.18, 0.06, { type: 'square', gain: 0.25 });
}
