// Timer de descanso: contagem regressiva, aviso sonoro e tela ligada durante o treino
export const REST_VERSION = '0.3.2';
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
