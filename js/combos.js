// Rodela Track — gerador de combos de boxe (guarda destra)
// Regras documentadas em spec-combos-boxe.md (R1–R21).

export const COMBOS_VERSION = '0.5.2';

// ---------------------------------------------------------------------------
// Vocabulário
// ---------------------------------------------------------------------------
const P = (code, name, side, base) => ({ code, name, type: 'punch', side, base, body: code.endsWith('B') });
export const MOVES = {
  1: P('1', 'Jab', 'front', 1), 2: P('2', 'Direto', 'back', 2), 3: P('3', 'Cruzado de frente', 'front', 3),
  4: P('4', 'Cruzado de trás', 'back', 4), 5: P('5', 'Upper de frente', 'front', 5), 6: P('6', 'Upper de trás', 'back', 6),
  '1B': P('1B', 'Jab no corpo', 'front', 1), '2B': P('2B', 'Direto no corpo', 'back', 2), '3B': P('3B', 'Cruzado de frente no corpo', 'front', 3),
  '4B': P('4B', 'Cruzado de trás no corpo', 'back', 4), '5B': P('5B', 'Upper de frente no corpo', 'front', 5), '6B': P('6B', 'Upper de trás no corpo', 'back', 6),
  E: { code: 'E', name: 'Esquiva para a esquerda', type: 'def', group: 'slip' },
  D: { code: 'D', name: 'Esquiva para a direita', type: 'def', group: 'slip' },
  P: { code: 'P', name: 'Pêndulo', type: 'def', group: 'roll' },
  BF: { code: 'BF', name: 'Bloqueio mão da frente', type: 'def', group: 'block', side: 'front' },
  BT: { code: 'BT', name: 'Bloqueio mão de trás', type: 'def', group: 'block', side: 'back' },
  PF: { code: 'PF', name: 'Passo à frente', type: 'move', group: 'step' },
  PT: { code: 'PT', name: 'Passo para trás', type: 'move', group: 'step' },
  PVE: { code: 'PVE', name: 'Pivô para a esquerda', type: 'move', group: 'pivot' },
  PVD: { code: 'PVD', name: 'Pivô para a direita', type: 'move', group: 'pivot' },
};
const M = (c) => MOVES[c];
const isPunch = (c) => M(c)?.type === 'punch';
const isDef = (c) => M(c)?.type === 'def';
const isMove = (c) => M(c)?.type === 'move';
const FRONT_FROM_SLIP = ['3', '3B', '5', '5B'];
const BACK_FROM_SLIP = ['2', '2B', '4', '4B', '6', '6B'];

export const DEFAULT_COMBO_CFG = {
  stages: 3, startLen: 3, inc: 'rand', maxLen: 8, between: 'continue', atMax: 'new',
  difficulty: 'mid', source: 'mix',
  allow: { body: true, slip: true, roll: true, block: true, step: true, pivot: true },
};

export const DEFAULT_FAVORITES = ['1 2', '1 2 3', '1 1 2', '2 3 2', '1 2 3B 3', '1 2 D 2', '1 2 E 3', '1 E 3B 3', '1 P 3 4', '3B 4B 3'];

// ---------------------------------------------------------------------------
// Validação (regras rígidas). Retorna null se válido, ou a mensagem do problema.
// ---------------------------------------------------------------------------
export function checkCombo(seq, { open = false } = {}) {
  // open=true: combo ainda em construção (ignora regras que dependem do final)
  if (!seq.length) return 'Combo vazio';
  for (const c of seq) if (!M(c)) return `Código desconhecido: ${c}`;
  const first = seq[0];
  if (!(isPunch(first) || first === 'PF')) return 'Deve começar com um golpe (ou passo à frente)';

  let sameHand = 0, lastSide = null, moveIdx = [];
  for (let i = 0; i < seq.length; i++) {
    const c = seq[i], prev = seq[i - 1], next = seq[i + 1], m = M(c);
    const last = i === seq.length - 1;
    const endRule = last && !open;

    if (isPunch(c)) {
      // R4: mesma mão no máximo 2x seguidas (defesa/movimento "zera")
      sameHand = m.side === lastSide ? sameHand + 1 : 1;
      lastSide = m.side;
      if (sameHand > 2) return `Mesma mão 3× seguidas (${seq.slice(i - 2, i + 1).join('-')})`;
      // R5: golpe idêntico repetido só 1-1; mesma base com altura diferente só nos cruzados
      if (prev && isPunch(prev)) {
        if (prev === c && c !== '1') return `Golpe repetido: ${c}-${c}`;
        if (prev !== c && M(prev).base === m.base && ![3, 4].includes(m.base)) return `${prev}-${c} não combina`;
      }
    } else {
      sameHand = 0; lastSide = null;
    }

    // R10/R13b: esquivas
    if (c === 'E' || c === 'D') {
      if (next) {
        const other = c === 'E' ? 'D' : 'E';
        const allowed = c === 'E' ? FRONT_FROM_SLIP : BACK_FROM_SLIP;
        if (next === c) return `Duas esquivas para o mesmo lado (${c}-${c})`;
        if (next === other) {
          if (prev === 'E' || prev === 'D') return 'Três esquivas seguidas';
        } else if (!allowed.includes(next)) {
          return c === 'E' ? `Depois de E vem golpe da mão da frente (3, 3B, 5), não ${next}` : `Depois de D vem golpe da mão de trás (2, 4, 6), não ${next}`;
        }
      }
    }
    // R11: pêndulo seguido de golpe
    if (c === 'P' && next && !isPunch(next)) return 'Depois do pêndulo vem um golpe';
    // R12: bloqueio seguido de contra-ataque; não termina com bloqueio
    if (c === 'BF') { if (endRule) return 'Não termina com bloqueio'; if (next && !['2', '2B', '4', '4B'].includes(next)) return 'Depois de BF vem 2 ou 4'; }
    if (c === 'BT') { if (endRule) return 'Não termina com bloqueio'; if (next && !['1', '3', '3B'].includes(next)) return 'Depois de BT vem 1 ou 3'; }
    // R13: no máximo 2 defesas seguidas (só E-D / D-E) e não termina com 2 defesas
    if (isDef(c) && prev && isDef(prev)) {
      if (!((c === 'E' && prev === 'D') || (c === 'D' && prev === 'E'))) return `Defesas seguidas não combinam (${prev}-${c})`;
      if (endRule) return 'Não termina com duas defesas';
    }
    // R14: passo à frente antes de golpe
    if (c === 'PF' && (endRule || (next && !isPunch(next)))) return 'Depois do passo à frente vem um golpe';
    // R15/R16: passo para trás e pivôs depois de golpe
    if (c === 'PT' && !(prev && isPunch(prev))) return 'Passo para trás vem depois de golpe';
    if (c === 'PVE' && !['1', '3', '3B'].includes(prev)) return 'Pivô para a esquerda vem depois de 1 ou 3';
    if (c === 'PVD' && !['2', '4', '4B'].includes(prev)) return 'Pivô para a direita vem depois de 2 ou 4';
    if (isMove(c)) moveIdx.push(i);
  }
  // R17: no máximo 1 passo/pivô a cada 4 movimentos
  for (let k = 1; k < moveIdx.length; k++) if (moveIdx[k] - moveIdx[k - 1] < 4) return 'Passos/pivôs muito próximos';
  return null;
}

// ---------------------------------------------------------------------------
// Pesos (regras "suaves")
// ---------------------------------------------------------------------------
const NATURAL = { // R6/R7
  '1>2': 5, '2>3': 4, '3>2': 4, '2>3B': 3, '3B>3': 4, '5>2': 3, '6>3': 3, '1>6': 2, '2>5': 2, '1>1': 2, '3>4': 2,
  '2B>3': 3, '3B>4B': 2, '4B>3': 2, '1>3': 1.5, '2>1': 1.5, '4>3': 2, '3>6': 1.5,
};
function diffMul(diff) {
  return diff === 'basic' ? { def: 0.35, move: 0.15, body: 0.35 } : diff === 'adv' ? { def: 1.4, move: 1.1, body: 1.3 } : { def: 0.9, move: 0.55, body: 1 };
}
function allowedCodes(cfg) {
  const a = { ...DEFAULT_COMBO_CFG.allow, ...(cfg.allow || {}) };
  return Object.keys(MOVES).filter((c) => {
    const m = M(c);
    if (m.type === 'punch') return a.body || !m.body;
    return a[m.group];
  });
}

function weight(seq, c, cfg, isLastSlot) {
  const prev = seq[seq.length - 1];
  const m = M(c);
  const mul = diffMul(cfg.difficulty);
  let w = 1;
  if (!prev) {
    // R1
    w = { 1: 8, 2: 2.5, '3B': 0.35 * mul.body, '4B': 0.1 * mul.body, PF: 0.3 * mul.move, 3: 0.15 }[c] ?? 0.02;
    return m.type === 'punch' || c === 'PF' ? w : 0;
  }
  const pm = M(prev);
  if (m.type === 'punch') {
    w = 1;
    if (pm.type === 'punch' && pm.side !== m.side) w *= 2.2; // R3
    w *= NATURAL[`${prev}>${c}`] || 1;
    if (prev === '1' && c === '1' && seq.length > 1) w *= 0.25; // jab duplo é mais comum no início
    if (c === '1' && seq.filter((x) => x === '1').length >= 2) w *= 0.3; // evita excesso de jabs
    if (m.body) w *= ([3, 4].includes(m.base) ? 0.35 : [2].includes(m.base) ? 0.2 : 0.07) * mul.body; // corpo: mais cruzados, poucos jabs/uppers
    if (pm.body && m.type === 'punch' && !m.body) w *= 1.8; // R7: corpo → cabeça
    if (pm.body && m.body) w *= 0.6;
    if ([5, 6].includes(m.base)) w *= 0.6;
    if (pm.type === 'move') w *= 2; // depois de passo/pivô, volta a golpear
    if (prev === 'P' && [3, 4].includes(m.base)) w *= 3; // R11: pêndulo → cruzado
  } else if (m.type === 'def') {
    w = 0.5 * mul.def;
    if (c === 'E' || c === 'D') {
      if (pm.type === 'def') w = 0.25 * mul.def; // R13b: raro
      if (c === 'E' && ['2', '4', '6'].includes(prev)) w *= 2.5; // R8
      if (c === 'D' && ['3', '1'].includes(prev)) w *= 2; // R9
    }
    if (c === 'P' && ['2', '3', '4'].includes(prev)) w *= 2;
    if (m.group === 'block') w *= 0.6;
    if (pm.type === 'move') w *= 0.1; // defesa logo após passo/pivô é rara
  } else {
    w = 0.35 * mul.move;
    if (c !== 'PF' && isLastSlot) w *= 3; // R15: no fim
    if (c === 'PF') w *= 0.6;
  }
  // R18: fim preferido com golpe de trás, defesa ou pivô; evitar jab isolado
  if (isLastSlot) {
    if (c === '1' && prev !== '1') w *= 0.3;
    if (m.side === 'back' && m.type === 'punch') w *= 1.4;
    if (m.group === 'slip' || m.group === 'roll' || m.group === 'pivot') w *= 1.5;
  }
  return w;
}

const pick = (items, rnd) => {
  const tot = items.reduce((a, x) => a + x.w, 0);
  let r = rnd() * tot;
  for (const it of items) { r -= it.w; if (r <= 0) return it.c; }
  return items[items.length - 1].c;
};

/** Estende `base` com `k` movimentos, resultado sempre válido. Retorna null se não conseguir. */
export function extend(base, k, cfg = DEFAULT_COMBO_CFG, rnd = Math.random) {
  const codes = allowedCodes(cfg);
  for (let attempt = 0; attempt < 300; attempt++) {
    const seq = base.slice();
    let ok = true;
    for (let i = 0; i < k; i++) {
      const isLast = i === k - 1;
      const cand = codes
        .map((c) => ({ c, w: weight(seq, c, cfg, isLast) }))
        .filter((x) => x.w > 0 && prefixOk([...seq, x.c]));
      if (!cand.length) { ok = false; break; }
      seq.push(pick(cand, rnd));
    }
    if (ok && !checkCombo(seq)) return seq;
  }
  return null;
}

const prefixOk = (seq) => !checkCombo(seq, { open: true });

export function newCombo(len, cfg = DEFAULT_COMBO_CFG, rnd = Math.random) {
  return extend([], Math.max(1, len), cfg, rnd) || ['1', '2'];
}

/** Próxima etapa: cresce `inc` movimentos; se passar do máximo, aplica `atMax`. */
export function grow(seq, cfg = DEFAULT_COMBO_CFG, rnd = Math.random) {
  const k = cfg.inc === 'rand' ? (rnd() < 0.5 ? 1 : 2) : Number(cfg.inc) || 1;
  if (seq.length + k <= cfg.maxLen) {
    const r = extend(seq, k, cfg, rnd) || extend(seq, 1, cfg, rnd);
    if (r && r.length <= cfg.maxLen) return r;
  }
  if (cfg.atMax === 'swap') {
    const keep = seq.slice(0, Math.max(1, cfg.maxLen - 2));
    return extend(keep, Math.min(2, cfg.maxLen - keep.length) || 1, cfg, rnd) || newCombo(cfg.startLen, cfg, rnd);
  }
  return newCombo(cfg.startLen, cfg, rnd);
}

export function parseCombo(text) {
  return String(text || '').toUpperCase().replace(/[·,\-–—]/g, ' ').split(/\s+/).filter(Boolean);
}
export const comboText = (seq) => seq.join(' · ');
