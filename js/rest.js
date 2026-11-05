// Timer de descanso: contagem regressiva, aviso sonoro e tela ligada durante o treino
export const REST_VERSION = '0.5.2';
let audio = null;
let out = null;          // ganho master → compressor → alto-falante
let volume = 2.2;        // multiplicador do volume dos avisos
const VOLUMES = { normal: 1, alto: 2.2, maximo: 3.6 };

/** Define o volume dos avisos: 'normal' | 'alto' | 'maximo'. */
export function setVolume(level) {
  volume = VOLUMES[level] ?? VOLUMES.alto;
  if (out) out.gain.value = volume;
}

function ensureChain() {
  if (out || !audio) return;
  // o compressor deixa o som "mais cheio" e evita distorção quando o ganho é alto
  const comp = audio.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.knee.value = 6;
  comp.ratio.value = 10;
  comp.attack.value = 0.002;
  comp.release.value = 0.15;
  out = audio.createGain();
  out.gain.value = volume;
  out.connect(comp).connect(audio.destination);
}

/** Precisa ser chamado dentro de um toque do usuário (exigência do iOS para liberar o som). */
export function unlockAudio() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'transient'; } catch { /* */ }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!audio) audio = new AC();
  if (audio.state === 'suspended') audio.resume();
  ensureChain();
  // buffer silencioso para "destravar" o áudio no Safari
  const b = audio.createBuffer(1, 1, 22050);
  const s = audio.createBufferSource();
  s.buffer = b; s.connect(audio.destination); s.start(0);
}

/** 3 bipes curtos (o último mais longo): fim do descanso da musculação. */
export function beep() {
  if (!ready()) return;
  const t0 = audio.currentTime + 0.05;
  [0, 0.35, 0.7].forEach((dt, i) => {
    const f = i === 2 ? 1175 : 880, dur = i === 2 ? 0.45 : 0.18;
    tone(f, t0 + dt, dur, { type: 'triangle', gain: 0.7 });
    tone(f * 2, t0 + dt, dur, { gain: 0.2 }); // harmônico deixa o bipe mais audível
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
  o.connect(g).connect(out || audio.destination);
  o.start(start);
  o.stop(start + dur + 0.05);
}
const ready = () => { if (!audio) return false; if (audio.state === 'suspended') audio.resume(); ensureChain(); return true; };

/** Arpejo ascendente para recorde. */
export function prBeep() {
  if (!ready()) return;
  const t = audio.currentTime + 0.05;
  [784, 988, 1175, 1568].forEach((f, i) => tone(f, t + i * 0.11, i === 3 ? 0.5 : 0.16, { type: 'triangle', gain: 0.7 }));
}

/** Sino de ringue (parciais inarmônicas), repetido `times` vezes. */
export function bell(times = 1) {
  if (!ready()) return;
  const t0 = audio.currentTime + 0.05;
  for (let k = 0; k < times; k++) {
    const t = t0 + k * 0.45;
    [[830, 0.7, 1.6], [2290, 0.4, 0.9], [3410, 0.2, 0.6], [4980, 0.1, 0.4]].forEach(([f, gn, d]) => tone(f, t, d, { gain: gn }));
  }
}

/** Gongo grave e longo (fim do round). */
export function gong() {
  if (!ready()) return;
  const t = audio.currentTime + 0.05;
  [[180, 0.7, 3.2], [270, 0.45, 2.6], [496, 0.35, 2.0], [745, 0.2, 1.4], [1100, 0.12, 0.9]].forEach(([f, gn, d]) => tone(f, t, d, { gain: gn }));
  bell(3);
}

/** Aviso de "faltam X segundos": 3 batidas secas. */
export function warnClap() {
  if (!ready()) return;
  const t = audio.currentTime + 0.05;
  // faixa de 2–3 kHz é onde o ouvido é mais sensível: soa alto mesmo com barulho de academia
  for (let i = 0; i < 3; i++) {
    tone(2400, t + i * 0.2, 0.08, { type: 'square', gain: 0.45 });
    tone(1200, t + i * 0.2, 0.08, { type: 'square', gain: 0.3 });
  }
}

/** Dois bipes agudos curtos: o combo mudou. */
export function comboBeep() {
  if (!ready()) return;
  const t = audio.currentTime + 0.05;
  tone(1320, t, 0.09, { type: 'triangle', gain: 0.6 });
  tone(1760, t + 0.12, 0.12, { type: 'triangle', gain: 0.6 });
}
