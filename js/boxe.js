// Rodela Track — treino de boxe (timer de rounds)
import * as db from './db.js';
import { h, toast, todayISO, uid, clone, fmtNum } from './util.js';
import { unlockAudio, keepAwake, fmtClock, bell, gong, warnClap } from './rest.js';

export const BOXE_VERSION = '0.4.1';

export const DEFAULT_BOX = { rounds: 6, mode: 'same', roundSec: 180, custom: [], restSec: 60, warnSec: 10, prepSec: 10 };

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
  return `${r.length} rounds × ${same ? fmtClock(r[0]) : 'tempos variados'} · descanso ${fmtClock(box.restSec)} · ~${fmtMin(totalSec(box))}`;
}

export function createBoxe(ctx) {
  const { state, go, render, upsertSession } = ctx;

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
          item('Número de rounds', stepper(() => b.rounds, (v) => { b.rounds = v; }, 1, 1, 30, (v) => String(v))),
          seg,
          sameRow,
          customBox));
        drawSeg();

        root.append(h('div', { class: 'section' }, 'Intervalos e avisos'));
        root.append(h('div', { class: 'card' },
          item('Descanso entre rounds', stepper(() => b.restSec, (v) => { b.restSec = v; }, 15, 0, 600)),
          item('Aviso antes do fim do round', stepper(() => b.warnSec, (v) => { b.warnSec = v; }, 5, 0, 60, (v) => (v ? `${v} s` : 'off')), 'Batidas secas e relógio amarelo quando faltar esse tempo'),
          item('Preparação', stepper(() => b.prepSec, (v) => { b.prepSec = v; }, 5, 0, 120, (v) => (v ? `${v} s` : 'off')), 'Contagem só antes do 1º round')));
        root.append(summary);
        upd();

        if (!isNew) root.append(h('button', { class: 'btn ghost danger block', onclick: remove }, 'Excluir este treino'));
      },
    };

    async function save() {
      t.name = (t.name || '').trim() || 'Boxe';
      if (!t.short) t.short = 'BX';
      if (b.mode === 'custom') b.custom = roundDurations(b);
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
    const phases = [];
    if (box.prepSec > 0) phases.push({ type: 'prep', sec: box.prepSec });
    durs.forEach((d, i) => {
      phases.push({ type: 'round', sec: d, n: i + 1 });
      if (i < durs.length - 1 && box.restSec > 0) phases.push({ type: 'rest', sec: box.restSec, n: i + 1 });
    });

    const run = { started: false, idx: 0, end: 0, paused: null, warned: false, done: false, startedAt: null, fought: [] };
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
        els.box = h('div', { class: 'bx-card' }, els.phase, els.time, els.sub, h('div', { class: 'bx-prog' }, els.prog), els.dots);
        els.end = h('div');
        root.append(els.box, h('div', { class: 'row mt' }, els.main), h('div', { class: 'row mt' }, h('div', { class: 'grow' }, els.skip), h('div', { class: 'grow' }, els.stop)), els.end,
          h('p', { class: 'muted small center mt' }, boxSummary(box)),
          h('p', { class: 'muted small center' }, 'Mantenha o app aberto: com a tela bloqueada o iPhone pausa o timer e os sons.'));
        draw();
        if (run.started && !run.done && !run.paused) startLoop();
        return () => { clearInterval(timer); timer = null; keepAwake(false); };
      },
    };

    const cur = () => phases[run.idx];
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
      run.idx++;
      run.warned = false;
      if (run.idx >= phases.length) { finish(); return; }
      const n = cur();
      run.end = (run.paused != null ? Date.now() : Math.min(run.end, Date.now()) ) + n.sec * 1000;
      if (run.paused != null) run.paused = n.sec;
      if (n.type === 'round' && sound) setTimeout(() => bell(1), p.type === 'round' ? 0 : 0);
    }

    function tick() {
      if (run.done || run.paused != null) return;
      const p = cur();
      const l = (run.end - Date.now()) / 1000;
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
      run.idx++;
      run.warned = false;
      if (run.idx >= phases.length) { finish(); return; }
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
        box: { rounds: fought.length, planned: durs.length, roundSecs: fought, restSec: box.restSec },
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
    if (b.roundSecs?.length) {
      root.append(h('div', { class: 'card mt' }, b.roundSecs.map((x, i) =>
        h('div', { class: 'detail-set' }, h('span', { class: 'muted' }, `Round ${i + 1}`), h('span', null, fmtClock(x))))));
    }
  }

  return { boxeEditor, boxeTimerView, boxeDetail };
}

export const boxSessionSub = (s) => {
  const b = s.box || {};
  const fight = (b.roundSecs || []).reduce((a, x) => a + x, 0);
  return `${b.rounds || 0} rounds · ${fmtNum(Math.round(fight / 60))} min de luta`;
};
