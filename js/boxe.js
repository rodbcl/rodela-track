// Rodela Track — treino de boxe (timer de rounds)
import * as db from './db.js';
import { h, toast, todayISO, uid, clone, fmtNum } from './util.js';
import { unlockAudio, keepAwake, fmtClock, bell, gong, warnClap, comboBeep } from './rest.js';
import { DEFAULT_COMBO_CFG, DEFAULT_FAVORITES, MOVES, checkCombo, newCombo, grow, parseCombo, comboText } from './combos.js';

export const BOXE_VERSION = '0.5.1';

export const DEFAULT_BOX = { rounds: 6, mode: 'same', roundSec: 180, custom: [], restSec: 60, warnSec: 10, prepSec: 10, comboRounds: [], combo: null };
const comboCfg = (box) => {
  const c = { ...DEFAULT_COMBO_CFG, ...(box.combo || {}) };
  c.allow = { ...DEFAULT_COMBO_CFG.allow, ...((box.combo && box.combo.allow) || {}) };
  return c;
};
const comboRoundsOf = (box) => (box.comboRounds || []).filter((n) => n >= 1 && n <= Math.max(1, box.rounds | 0));

/** Combo em "chips" grandes (golpes claros, defesas escuras, movimentação tracejada). */
export function comboChips(seq, cls = '') {
  return h('div', { class: `cb-row ${cls}` }, seq.map((c) => {
    const t = MOVES[c]?.type || 'punch';
    return h('span', { class: `cb-chip ${t}`, title: MOVES[c]?.name || c }, c);
  }));
}

/** Duração de cada round conforme o modo. */
export function roundDurations(box) {
  const n = Math.max(1, box.rounds | 0);
  if (box.mode === 'custom') return Array.from({ length: n }, (_, i) => box.custom[i] || box.roundSec);
  return Array.from({ length: n }, () => box.roundSec);
}
export const totalSec = (box) => {
  const r = roundDurations(box);
  return r.reduce((a, b) => a + b, 0) + box.restSec * (r.length - 1) + (box.prepSec || 0);
};
const fmtMin = (sec) => (sec >= 3600 ? `${Math.floor(sec / 3600)}h${String(Math.round((sec % 3600) / 60)).padStart(2, '0')}` : `${Math.round(sec / 60)} min`);

export function boxSummary(box) {
  const r = roundDurations(box);
  const same = r.every((x) => x === r[0]);
  const cr = comboRoundsOf(box).length;
  return `${r.length} rounds × ${same ? fmtClock(r[0]) : 'tempos variados'} · descanso ${fmtClock(box.restSec)} · ~${fmtMin(totalSec(box))}`
    + (cr ? ` · combos em ${cr === r.length ? 'todos os rounds' : `${cr} round${cr > 1 ? 's' : ''}`}` : '');
}

export function createBoxe(ctx) {
  const { state, go, render, upsertSession } = ctx;

  // ---------- Favoritos de combos ----------
  async function load() {
    const favs = await db.get('kv', 'comboFavs');
    state.comboFavs = Array.isArray(favs) ? favs : DEFAULT_FAVORITES.slice();
  }
  const saveFavs = () => db.put('kv', state.comboFavs, 'comboFavs');
  const validFavs = (cfg) => (state.comboFavs || []).map(parseCombo).filter((s) => !checkCombo(s) && s.length <= cfg.maxLen);

  function favoritesView() {
    return {
      title: 'Combos favoritos',
      render(root) {
        const err = h('div', { class: 'warn small', style: 'min-height:18px;margin-top:6px' });
        const input = h('input', { class: 'input', placeholder: 'Ex.: 1 2 3B 3 P 2', autocapitalize: 'characters', autocomplete: 'off' });
        const add = async () => {
          const seq = parseCombo(input.value);
          if (!seq.length) return;
          const e = checkCombo(seq);
          if (e) { err.textContent = `Combo inválido: ${e}`; return; }
          const txt = seq.join(' ');
          if (state.comboFavs.includes(txt)) { err.textContent = 'Esse combo já está na lista'; return; }
          state.comboFavs.push(txt); await saveFavs(); input.value = ''; err.textContent = ''; draw();
        };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
        const list = h('div');
        const draw = () => list.replaceChildren(state.comboFavs.length
          ? h('div', { class: 'list' }, state.comboFavs.map((f, i) => h('div', { class: 'list-item' },
            h('div', { class: 'grow' }, comboChips(parseCombo(f), 'small')),
            h('button', { class: 'icon-btn danger', 'aria-label': 'Remover', onclick: async () => { state.comboFavs.splice(i, 1); await saveFavs(); draw(); } }, '✕'))))
          : h('div', { class: 'empty' }, 'Nenhum favorito.'));
        root.append(h('div', { class: 'card' },
          h('div', { class: 'row' }, input, h('button', { class: 'btn', onclick: add }, 'Adicionar')), err,
          h('div', { class: 'muted small' }, 'Códigos: 1–6 (B = corpo) · E/D esquiva · P pêndulo · BF/BT bloqueio · PF/PT passo · PVE/PVD pivô')));
        root.append(list);
        draw();
        root.append(h('button', { class: 'btn ghost block', onclick: async () => {
          if (!confirm('Restaurar a lista padrão de favoritos? Os seus combos adicionados serão removidos.')) return;
          state.comboFavs = DEFAULT_FAVORITES.slice(); await saveFavs(); draw();
        } }, 'Restaurar favoritos padrão'));
      },
    };
  }

  function sampleProgression(box) {
    const cfg = comboCfg(box);
    let s = baseCombo(cfg);
    for (let i = 1; i < cfg.stages; i++) s = nextStage(s, cfg);
    return s;
  }
  function baseCombo(cfg) {
    const favs = cfg.source === 'gen' ? [] : validFavs(cfg);
    if (favs.length && (cfg.source === 'fav' || Math.random() < 0.5)) return favs[Math.floor(Math.random() * favs.length)].slice();
    return newCombo(cfg.startLen, cfg);
  }
  function nextStage(seq, cfg) {
    const minInc = cfg.inc === 'rand' ? 1 : Number(cfg.inc) || 1;
    if (seq.length + minInc > cfg.maxLen && cfg.atMax === 'new') return baseCombo(cfg);
    return grow(seq, cfg);
  }

  // ======================================================================
  // Editor
  // ======================================================================
  function boxeEditor(tpl) {
    const isNew = !tpl;
    const t = tpl ? clone(tpl) : { id: uid(), kind: 'boxe', name: 'Boxe', short: 'BX', order: state.templates.length, exercises: [], box: clone(DEFAULT_BOX) };
    t.box = { ...DEFAULT_BOX, ...(t.box || {}) };
    const b = t.box;
    let dirty = isNew;

    const view = {
      title: isNew ? 'Novo treino de boxe' : 'Editar boxe',
      actions: [{ label: 'Salvar', primary: true, onclick: () => save() }],
      beforeLeave() { return !dirty || confirm('Descartar as alterações?'); },
      render(root) {
        const touch = () => { dirty = true; };
        const summary = h('div', { class: 'muted small center', style: 'margin:4px 0 12px' });
        const customBox = h('div');

        const stepper = (get, set, step, min, max, fmt = fmtClock) => {
          const val = h('b', { class: 'step-val' }, fmt(get()));
          const apply = (v) => { set(Math.max(min, Math.min(max, v))); val.textContent = fmt(get()); touch(); upd(); };
          return h('div', { class: 'row' },
            h('button', { class: 'icon-btn', 'aria-label': 'Diminuir', onclick: () => apply(get() - step) }, '−'),
            val,
            h('button', { class: 'icon-btn', 'aria-label': 'Aumentar', onclick: () => apply(get() + step) }, '+'));
        };
        const item = (label, ctrl, hint) => h('div', { class: 'set-item' },
          h('div', null, h('div', null, label), hint ? h('div', { class: 'muted small' }, hint) : null), ctrl);

        const seg = h('div', { class: 'seg', style: 'margin:12px 0 0' });
        const drawSeg = () => seg.replaceChildren(
          h('button', { class: b.mode === 'same' ? 'on' : '', onclick: () => { b.mode = 'same'; touch(); drawSeg(); upd(); } }, 'Mesmo tempo'),
          h('button', { class: b.mode === 'custom' ? 'on' : '', onclick: () => { b.mode = 'custom'; touch(); drawSeg(); upd(); } }, 'Personalizado'));

        const sameRow = item('Duração de cada round', stepper(() => b.roundSec, (v) => { b.roundSec = v; }, 15, 15, 1800));

        function drawCustom() {
          if (b.mode !== 'custom') { customBox.replaceChildren(); sameRow.hidden = false; return; }
          sameRow.hidden = true;
          const durs = roundDurations(b);
          b.custom = durs.slice();
          customBox.replaceChildren(
            ...durs.map((_, i) => item(`Round ${i + 1}`, stepper(() => b.custom[i], (v) => { b.custom[i] = v; }, 15, 15, 1800))),
            h('div', { class: 'row', style: 'padding-top:10px' },
              h('button', { class: 'btn small', onclick: () => { b.custom = b.custom.map(() => b.custom[0]); touch(); upd(); } }, 'Igualar ao round 1')));
        }
        function upd() {
          drawCustom();
          summary.textContent = `Total: ~${fmtMin(totalSec(b))} · ${fmtMin(roundDurations(b).reduce((a, x) => a + x, 0))} de luta`;
        }

        root.append(h('div', { class: 'card' },
          h('div', { class: 'row' },
            h('label', { class: 'field grow' }, h('span', null, 'Nome'),
              h('input', { class: 'input', value: t.name, oninput: (e) => { t.name = e.target.value; touch(); } })),
            h('label', { class: 'field', style: 'width:84px' }, h('span', null, 'Sigla'),
              h('input', { class: 'input', value: t.short, maxlength: 3, style: 'text-align:center', oninput: (e) => { t.short = e.target.value.trim(); touch(); } })))));

        root.append(h('div', { class: 'section' }, 'Rounds'));
        root.append(h('div', { class: 'card' },
          item('Número de rounds', stepper(() => b.rounds, (v) => { b.rounds = v; view.redrawCombo?.(); }, 1, 1, 30, (v) => String(v))),
          seg,
          sameRow,
          customBox));
        drawSeg();

        root.append(h('div', { class: 'section' }, 'Intervalos e avisos'));
        root.append(h('div', { class: 'card' },
          item('Descanso entre rounds', stepper(() => b.restSec, (v) => { b.restSec = v; }, 15, 0, 600)),
          item('Aviso antes do fim do round', stepper(() => b.warnSec, (v) => { b.warnSec = v; }, 5, 0, 60, (v) => (v ? `${v} s` : 'off')), 'Batidas secas e relógio amarelo quando faltar esse tempo'),
          item('Preparação', stepper(() => b.prepSec, (v) => { b.prepSec = v; }, 5, 0, 120, (v) => (v ? `${v} s` : 'off')), 'Contagem só antes do 1º round')));
        // ---------- Combos (progressão) ----------
        b.combo = comboCfg(b);
        const cc = b.combo;
        const comboBox = h('div');
        const segc = (opts, get, set) => {
          const el = h('div', { class: 'seg', style: 'margin:6px 0 0' });
          const draw = () => el.replaceChildren(...opts.map(([v, l]) => h('button', { class: get() === v ? 'on' : '', onclick: () => { set(v); touch(); draw(); } }, l)));
          draw();
          return el;
        };
        const block = (label, ctrl, hint) => h('div', { class: 'cb-set' }, h('div', null, label), hint ? h('div', { class: 'muted small' }, hint) : null, ctrl);
        const drawCombo = () => {
          const n = Math.max(1, b.rounds | 0);
          b.comboRounds = comboRoundsOf(b);
          const chips = h('div', { class: 'rchips' }, Array.from({ length: n }, (_, i) => {
            const r = i + 1, on = b.comboRounds.includes(r);
            return h('button', { class: 'rchip' + (on ? ' on' : ''), onclick: () => {
              b.comboRounds = on ? b.comboRounds.filter((x) => x !== r) : [...b.comboRounds, r].sort((x, y) => x - y);
              touch(); drawCombo(); upd();
            } }, `R${r}`);
          }));
          const parts = [
            h('div', { class: 'muted small', style: 'margin-bottom:8px' }, 'Escolha os rounds com progressão de combos. Os demais são rounds comuns.'),
            chips,
            h('div', { class: 'row', style: 'margin-top:8px' },
              h('button', { class: 'btn small', onclick: () => { b.comboRounds = Array.from({ length: n }, (_, i) => i + 1); touch(); drawCombo(); upd(); } }, 'Todos'),
              h('button', { class: 'btn small', onclick: () => { b.comboRounds = []; touch(); drawCombo(); upd(); } }, 'Nenhum')),
          ];
          if (b.comboRounds.length) {
            const stageSec = Math.round(Math.min(...roundDurations(b)) / cc.stages);
            parts.push(
              item('Etapas por round', stepper(() => cc.stages, (v) => { cc.stages = v; drawCombo(); }, 1, 1, 6, (v) => String(v)), `O combo cresce a cada ~${fmtClock(stageSec)}`),
              item('Tamanho inicial', stepper(() => cc.startLen, (v) => { cc.startLen = v; }, 1, 2, 4, (v) => `${v} mov.`)),
              item('Tamanho máximo', stepper(() => cc.maxLen, (v) => { cc.maxLen = v; }, 1, 4, 12, (v) => `${v} mov.`)),
              block('Crescimento por etapa', segc([['1', '+1'], ['2', '+2'], ['rand', '+1 ou +2']], () => cc.inc, (v) => { cc.inc = v; })),
              block('No próximo round com combos', segc([['continue', 'Continuar crescendo'], ['new', 'Combo novo']], () => cc.between, (v) => { cc.between = v; })),
              block('Ao atingir o máximo', segc([['new', 'Combo novo'], ['swap', 'Trocar o final']], () => cc.atMax, (v) => { cc.atMax = v; })),
              block('Dificuldade', segc([['basic', 'Básico'], ['mid', 'Intermediário'], ['adv', 'Avançado']], () => cc.difficulty, (v) => { cc.difficulty = v; })),
              block('Origem dos combos', segc([['gen', 'Gerador'], ['mix', 'Gerador + favoritos'], ['fav', 'Só favoritos']], () => cc.source, (v) => { cc.source = v; })),
              h('div', { class: 'cb-set' }, h('div', null, 'Movimentos permitidos'),
                h('div', { class: 'rchips', style: 'margin-top:6px' }, [['body', 'Golpes no corpo'], ['slip', 'Esquivas'], ['roll', 'Pêndulo'], ['block', 'Bloqueios'], ['step', 'Passos'], ['pivot', 'Pivôs']].map(([k, l]) =>
                  h('button', { class: 'rchip' + (cc.allow[k] ? ' on' : ''), onclick: () => { cc.allow[k] = !cc.allow[k]; touch(); drawCombo(); } }, l)))),
              h('button', { class: 'btn small block', onclick: () => go(favoritesView()) }, `Combos favoritos (${(state.comboFavs || []).length})`),
              h('div', { class: 'muted small', style: 'margin-top:8px' }, 'Exemplo: ', comboChips(sampleProgression(b), 'small')));
          }
          comboBox.replaceChildren(...parts);
        };
        root.append(h('div', { class: 'section' }, 'Combos (progressão)'));
        root.append(h('div', { class: 'card' }, comboBox));
        drawCombo();
        view.redrawCombo = drawCombo;

        root.append(summary);
        upd();

        if (!isNew) root.append(h('button', { class: 'btn ghost danger block', onclick: remove }, 'Excluir este treino'));
      },
    };

    async function save() {
      t.name = (t.name || '').trim() || 'Boxe';
      if (!t.short) t.short = 'BX';
      if (b.mode === 'custom') b.custom = roundDurations(b);
      b.comboRounds = comboRoundsOf(b);
      await db.put('templates', t);
      const i = state.templates.findIndex((x) => x.id === t.id);
      if (i >= 0) state.templates[i] = t; else state.templates.push(t);
      state.templates.sort((a, c) => a.order - c.order);
      dirty = false;
      toast('Treino de boxe salvo');
      state.stack.pop(); render();
    }
    async function remove() {
      if (!confirm(`Excluir "${t.name}"? O histórico continua salvo.`)) return;
      await db.del('templates', t.id);
      state.templates = state.templates.filter((x) => x.id !== t.id);
      dirty = false;
      state.stack.pop(); render();
    }
    return view;
  }

  // ======================================================================
  // Timer
  // ======================================================================
  function boxeTimerView(tpl) {
    const box = { ...DEFAULT_BOX, ...tpl.box };
    const durs = roundDurations(box);
    const cfg = comboCfg(box);
    const cRounds = comboRoundsOf(box);
    const phases = [];
    if (box.prepSec > 0) phases.push({ type: 'prep', sec: box.prepSec });
    durs.forEach((d, i) => {
      phases.push({ type: 'round', sec: d, n: i + 1, combo: cRounds.includes(i + 1) });
      if (i < durs.length - 1 && box.restSec > 0) phases.push({ type: 'rest', sec: box.restSec, n: i + 1 });
    });

    const run = { started: false, idx: 0, end: 0, paused: null, warned: false, done: false, startedAt: null, fought: [],
      combo: null, stage: 0, pending: null, prevCombo: null, combos: {} };
    let timer = null;
    let els = {};

    const view = {
      title: tpl.name,
      beforeLeave() {
        if (!run.started || run.done) return true;
        return confirm('Parar o treino de boxe? O progresso não salvo será perdido.');
      },
      render(root) {
        els.phase = h('div', { class: 'bx-phase' });
        els.time = h('div', { class: 'bx-time' });
        els.sub = h('div', { class: 'bx-sub' });
        els.prog = h('i');
        els.dots = h('div', { class: 'bx-dots' });
        els.main = h('button', { class: 'btn primary bx-main', onclick: mainBtn });
        els.skip = h('button', { class: 'btn', onclick: skip }, 'Pular');
        els.stop = h('button', { class: 'btn danger', onclick: stop }, 'Encerrar');
        els.combo = h('div', { class: 'bx-combo' });
        els.box = h('div', { class: 'bx-card' }, els.phase, els.time, els.sub, els.combo, h('div', { class: 'bx-prog' }, els.prog), els.dots);
        els.cbBar = h('div', { class: 'row mt', hidden: true },
          h('button', { class: 'btn grow', onclick: rerollCombo }, '⟳ Trocar combo'),
          h('button', { class: 'btn grow', onclick: favCombo }, '★ Favoritar'));
        els.end = h('div');
        root.append(els.box, els.cbBar, h('div', { class: 'row mt' }, els.main), h('div', { class: 'row mt' }, h('div', { class: 'grow' }, els.skip), h('div', { class: 'grow' }, els.stop)), els.end,
          h('p', { class: 'muted small center mt' }, boxSummary(box)),
          h('p', { class: 'muted small center' }, 'Mantenha o app aberto: com a tela bloqueada o iPhone pausa o timer e os sons.'));
        draw();
        if (run.started && !run.done && !run.paused) startLoop();
        return () => { clearInterval(timer); timer = null; keepAwake(false); };
      },
    };

    const cur = () => phases[run.idx];

    // ---------- combos ----------
    const firstCombo = () => (cfg.between === 'continue' && run.prevCombo ? nextStage(run.prevCombo, cfg) : baseCombo(cfg));
    const logCombo = (n) => { (run.combos[n] ||= []).push(run.combo.join(' ')); };
    function leavePhase() {
      const p = cur();
      if (p?.type === 'round' && p.combo && run.combo) run.prevCombo = run.combo.slice();
    }
    function enterPhase() {
      const p = cur();
      if (!p) return;
      if (p.type === 'round') {
        if (p.combo) {
          run.combo = run.pending || firstCombo();
          run.pending = null; run.stage = 0;
          logCombo(p.n);
        } else run.combo = null;
      } else {
        run.combo = null;
        const nextR = phases.slice(run.idx + 1).find((x) => x.type === 'round');
        run.pending = nextR?.combo ? firstCombo() : null;
      }
    }
    function rerollCombo() {
      const p = cur();
      if (!run.combo || p?.type !== 'round') return;
      run.combo = newCombo(Math.max(2, run.combo.length), cfg);
      const log = run.combos[p.n]; if (log?.length) log[log.length - 1] = run.combo.join(' ');
      draw();
    }
    async function favCombo() {
      if (!run.combo) return;
      const txt = run.combo.join(' ');
      if ((state.comboFavs || []).includes(txt)) { toast('Já está nos favoritos'); return; }
      state.comboFavs = [...(state.comboFavs || []), txt];
      await saveFavs();
      toast('Combo salvo nos favoritos');
    }
    const left = () => (run.paused != null ? run.paused : Math.max(0, (run.end - Date.now()) / 1000));

    function startLoop() {
      clearInterval(timer);
      timer = setInterval(tick, 200);
      if (state.settings.wake) keepAwake(true);
    }

    function mainBtn() {
      unlockAudio(); // toque libera o áudio no iOS
      if (run.done) return;
      if (!run.started) {
        run.started = true;
        run.startedAt = Date.now();
        run.idx = 0;
        run.end = Date.now() + cur().sec * 1000;
        enterPhase();
        if (cur().type === 'round') bell(1);
        startLoop();
      } else if (run.paused != null) {
        run.end = Date.now() + run.paused * 1000;
        run.paused = null;
        startLoop();
      } else {
        run.paused = left();
        clearInterval(timer); timer = null;
      }
      draw();
    }

    function advance({ sound = true } = {}) {
      const p = cur();
      if (p.type === 'round') {
        run.fought[p.n - 1] = Math.round(p.sec - left());
        if (sound) gong();
      }
      leavePhase();
      run.idx++;
      run.warned = false;
      if (run.idx >= phases.length) { finish(); return; }
      enterPhase();
      const n = cur();
      run.end = (run.paused != null ? Date.now() : Math.min(run.end, Date.now()) ) + n.sec * 1000;
      if (run.paused != null) run.paused = n.sec;
      if (n.type === 'round' && sound) setTimeout(() => bell(1), p.type === 'round' ? 0 : 0);
    }

    function tick() {
      if (run.done || run.paused != null) return;
      const p = cur();
      const l = (run.end - Date.now()) / 1000;
      if (p.type === 'round' && p.combo && run.combo && l > 0) {
        const stage = Math.min(cfg.stages - 1, Math.floor((p.sec - l) / (p.sec / cfg.stages)));
        if (stage > run.stage) {
          run.stage = stage;
          run.combo = nextStage(run.combo, cfg);
          logCombo(p.n);
          if (state.settings.sound) comboBeep();
        }
      }
      if (p.type === 'round' && box.warnSec > 0 && !run.warned && l <= box.warnSec && l > 0) {
        run.warned = true;
        if (state.settings.sound) warnClap();
      }
      if (l <= 0) {
        const late = -l;
        const end = run.end;
        advance({ sound: state.settings.sound && late < 20 });
        if (!run.done) run.end = end + cur().sec * 1000; // encadeia sem perder precisão
      }
      draw();
    }

    function skip() {
      if (!run.started || run.done) return;
      unlockAudio();
      const p = cur();
      if (p.type === 'round') run.fought[p.n - 1] = Math.round(p.sec - left());
      leavePhase();
      run.idx++;
      run.warned = false;
      if (run.idx >= phases.length) { finish(); return; }
      enterPhase();
      if (run.paused != null) run.paused = cur().sec;
      else run.end = Date.now() + cur().sec * 1000;
      if (cur().type === 'round' && state.settings.sound) bell(1);
      draw();
    }

    function stop() {
      if (!run.started) { state.stack.pop(); render(); return; }
      if (run.done) return;
      if (!confirm('Encerrar o treino agora?')) return;
      const p = cur();
      if (p.type === 'round') run.fought[p.n - 1] = Math.round(p.sec - left());
      finish();
    }

    function finish() {
      run.done = true;
      clearInterval(timer); timer = null;
      keepAwake(false);
      draw();
      const fought = run.fought.filter((x) => x > 0);
      const notes = h('textarea', { class: 'input', placeholder: 'Como foi? (técnica, sparring, saco…)' });
      els.end.replaceChildren(h('div', { class: 'card mt' },
        h('div', { class: 'card-title' }, 'Treino concluído'),
        h('div', { class: 'muted small', style: 'margin-bottom:10px' }, `${fought.length} rounds · ${fmtClock(fought.reduce((a, b) => a + b, 0))} de luta`),
        h('label', { class: 'field' }, h('span', null, 'Observações'), notes),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary grow', onclick: () => saveSession(notes.value) }, 'Salvar treino'),
          h('button', { class: 'btn ghost danger', onclick: () => { if (confirm('Descartar este treino?')) { state.stack.pop(); render(); } } }, 'Descartar'))));
    }

    async function saveSession(notes) {
      const fought = run.fought.map((x) => x || 0).filter((x) => x > 0);
      const s = {
        id: uid(), date: todayISO(), kind: 'boxe', templateId: tpl.id, templateName: tpl.name, short: tpl.short || 'BX',
        startedAt: run.startedAt, finishedAt: Date.now(), notes: notes || '', exercises: [],
        box: {
          rounds: fought.length, planned: durs.length, roundSecs: fought, restSec: box.restSec,
          detail: run.fought.map((sec, i) => (sec > 0 ? { n: i + 1, sec, combos: run.combos[i + 1] || [] } : null)).filter(Boolean),
        },
      };
      await db.put('sessions', s);
      upsertSession(s);
      toast(`Boxe salvo · ${fought.length} rounds`);
      state.stack = []; state.tab = 'treino';
      render();
    }

    function draw() {
      const p = cur() || phases[phases.length - 1];
      const l = run.started ? left() : p.sec;
      const type = run.done ? 'done' : p.type;
      els.box.className = `bx-card ${type}` + (p.type === 'round' && run.started && !run.done && l <= box.warnSec && box.warnSec > 0 ? ' warn' : '') + (run.paused != null ? ' paused' : '');
      els.phase.textContent = run.done ? 'Concluído' : p.type === 'prep' ? 'Preparação' : p.type === 'rest' ? 'Descanso' : `Round ${p.n} de ${durs.length}`;
      els.time.textContent = run.done ? '✓' : fmtClock(l);
      const nextRound = phases.slice(run.idx + 1).find((x) => x.type === 'round');
      els.sub.textContent = run.done ? '' : run.paused != null ? 'Pausado' : p.type === 'round' ? (nextRound ? `Depois: descanso ${fmtClock(box.restSec)}` : 'Último round!') : nextRound ? `Próximo: round ${nextRound.n} (${fmtClock(nextRound.sec)})` : '';
      els.prog.style.width = `${run.done ? 100 : (1 - l / p.sec) * 100}%`;
      els.dots.replaceChildren(...durs.map((_, i) => {
        const doneR = run.fought[i] > 0 && !(p.type === 'round' && p.n === i + 1 && !run.done);
        const now = !run.done && p.type === 'round' && p.n === i + 1;
        return h('span', { class: 'bx-dot' + (doneR ? ' on' : '') + (now ? ' now' : '') });
      }));
      // combo atual (round) ou prévia do próximo (descanso/preparação)
      const showNow = !run.done && p.type === 'round' && run.combo;
      const showNext = !run.done && run.started && p.type !== 'round' && run.pending;
      const key = showNow ? `n:${run.combo.join(' ')}:${run.stage}` : showNext ? `p:${run.pending.join(' ')}` : '';
      if (key !== els.comboKey) {
        els.comboKey = key;
        els.combo.replaceChildren(...(showNow
          ? [h('div', { class: 'bx-combo-lbl' }, cfg.stages > 1 ? `Combo · etapa ${run.stage + 1}/${cfg.stages}` : 'Combo'), comboChips(run.combo, 'big')]
          : showNext ? [h('div', { class: 'bx-combo-lbl' }, 'Próximo combo'), comboChips(run.pending, 'big')] : []));
      }
      els.cbBar.hidden = !showNow;
      els.main.textContent = run.done ? 'Concluído' : !run.started ? 'Começar' : run.paused != null ? 'Continuar' : 'Pausar';
      els.main.disabled = run.done;
      els.skip.disabled = !run.started || run.done;
    }

    return view;
  }

  /** Detalhe de um treino de boxe salvo (usado no histórico). */
  function boxeDetail(s, root) {
    const b = s.box || { rounds: 0, roundSecs: [] };
    const fight = (b.roundSecs || []).reduce((a, x) => a + x, 0);
    const dur = s.startedAt && s.finishedAt ? Math.round((s.finishedAt - s.startedAt) / 60000) : null;
    root.append(h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('b', null, b.rounds), h('span', null, b.planned && b.planned !== b.rounds ? `rounds (de ${b.planned})` : 'rounds')),
      h('div', { class: 'stat' }, h('b', null, fmtClock(fight)), h('span', null, 'de luta')),
      dur ? h('div', { class: 'stat' }, h('b', null, `${dur} min`), h('span', null, 'duração total')) : null,
      h('div', { class: 'stat' }, h('b', null, fmtClock(b.restSec || 0)), h('span', null, 'descanso'))));
    const rows = b.detail || (b.roundSecs || []).map((sec, i) => ({ n: i + 1, sec, combos: [] }));
    if (rows.length) {
      root.append(h('div', { class: 'card mt' }, rows.map((r) => h('div', { class: 'detail-set', style: 'flex-direction:column;gap:6px' },
        h('div', { class: 'row between' }, h('span', { class: 'muted' }, `Round ${r.n}`), h('span', null, fmtClock(r.sec))),
        r.combos?.length ? h('div', null, r.combos.map((c) => comboChips(parseCombo(c), 'small'))) : null))));
    }
  }

  return { load, boxeEditor, boxeTimerView, boxeDetail, favoritesView };
}

export const boxSessionSub = (s) => {
  const b = s.box || {};
  const fight = (b.roundSecs || []).reduce((a, x) => a + x, 0);
  return `${b.rounds || 0} rounds · ${fmtNum(Math.round(fight / 60))} min de luta`;
};
