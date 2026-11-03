// Rodela Track — app principal (etapa 1: Treino)
import * as db from './db.js';
import {
  h, toast, todayISO, fmtDate, fmtShort, relDays, daysAgo, weekday, toISO, pad,
  WEEKDAYS, MONTHS, parseNum, fmtNum, uid, normName, clone, debounce, fmtDuration,
} from './util.js';
import { lineChart } from './chart.js';

const APP_VERSION = '0.1.0';

const state = {
  templates: [],
  sessions: [],      // mais recentes primeiro
  draft: null,       // treino em andamento
  lastBackup: null,
  tab: 'treino',
  stack: [],
  rest: null,        // timestamp do início do descanso
  histMonth: null,   // {y, m}
};

const $view = document.getElementById('view');
const $title = document.getElementById('title');
const $back = document.getElementById('back');
const $actions = document.getElementById('top-actions');

const ICON = {
  chev: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>',
};
const icon = (name) => h('span', { style: 'display:contents', html: ICON[name] });

// ======================================================================
// Inicialização
// ======================================================================
async function boot() {
  await loadAll();
  if (!state.templates.length && !(await db.get('kv', 'seeded'))) await seed();
  document.querySelectorAll('#tabbar button').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  $back.addEventListener('click', back);
  render();
  registerSW();
}

async function loadAll() {
  state.templates = (await db.getAll('templates')).sort((a, b) => a.order - b.order);
  state.sessions = sortSessions(await db.getAll('sessions'));
  state.draft = (await db.get('kv', 'draft')) || null;
  state.lastBackup = (await db.get('kv', 'lastBackup')) || null;
}

function sortSessions(arr) {
  return arr.sort((a, b) => b.date.localeCompare(a.date) || (b.finishedAt || 0) - (a.finishedAt || 0));
}

async function seed() {
  const tpls = ['A', 'B', 'C'].map((s, i) => ({ id: uid(), name: `Treino ${s}`, short: s, order: i, exercises: [] }));
  await db.putMany('templates', tpls);
  await db.put('kv', true, 'seeded');
  state.templates = tpls;
}

// ======================================================================
// Navegação
// ======================================================================
const roots = { treino: treinoHome, historico: historicoView, dieta: dietaView, ajustes: ajustesView };

function current() {
  return state.stack.length ? state.stack[state.stack.length - 1] : roots[state.tab]();
}

function go(view) { state.stack.push(view); render(); }

function back() {
  const v = state.stack[state.stack.length - 1];
  if (v?.beforeLeave && !v.beforeLeave()) return;
  state.stack.pop();
  render();
}

function switchTab(tab) {
  for (let i = state.stack.length - 1; i >= 0; i--) {
    const v = state.stack[i];
    if (v.beforeLeave && !v.beforeLeave()) return;
  }
  state.tab = tab;
  state.stack = [];
  render();
}

let ticker = null;
function stopTicker() { if (ticker) { clearInterval(ticker); ticker = null; } }

async function render({ keepScroll = false } = {}) {
  const v = current();
  stopTicker();
  const y = window.scrollY;
  document.body.classList.toggle('sub', state.stack.length > 0);
  $title.textContent = v.title;
  $back.hidden = !state.stack.length;
  $actions.replaceChildren(...(v.actions || []).map((a) =>
    h('button', { class: 'top-btn' + (a.primary ? ' primary' : ''), onclick: a.onclick }, a.label)));
  document.querySelectorAll('#tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.tab));
  const root = h('div');
  $view.replaceChildren(root);
  await v.render(root);
  window.scrollTo(0, keepScroll ? y : 0);
}
const rerender = () => render({ keepScroll: true });

// ======================================================================
// Helpers de dados
// ======================================================================
function lastPerf(key, excludeId) {
  for (const s of state.sessions) {
    if (s.id === excludeId) continue;
    const ex = s.exercises.find((e) => e.key === key && e.sets.some((x) => x.done));
    if (ex) return { date: s.date, sets: ex.sets.filter((x) => x.done) };
  }
  return null;
}

function nextTemplateId() {
  const t = state.templates;
  if (!t.length) return null;
  const last = state.sessions.find((s) => s.templateId);
  if (!last) return t[0].id;
  const i = t.findIndex((x) => x.id === last.templateId);
  return t[(i + 1) % t.length].id;
}

function knownExerciseNames() {
  const map = new Map();
  for (const t of state.templates) for (const e of t.exercises) map.set(normName(e.name), e.name);
  for (const s of state.sessions) for (const e of s.exercises) if (!map.has(e.key)) map.set(e.key, e.name);
  return [...map.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function exDatalist() {
  return h('datalist', { id: 'ex-names' }, knownExerciseNames().map((n) => h('option', { value: n })));
}

const setsText = (sets) => sets.map((s) => (s.w != null ? `${fmtNum(s.w)}×${s.r ?? '?'}` : `${s.r ?? '?'} reps`)).join(', ');
const countSets = (s) => s.exercises.reduce((n, e) => n + e.sets.filter((x) => x.done).length, 0);
const volume = (s) => s.exercises.reduce((v, e) => v + e.sets.reduce((a, x) => a + (x.done && x.w && x.r ? x.w * x.r : 0), 0), 0);

function upsertSession(s) {
  const i = state.sessions.findIndex((x) => x.id === s.id);
  if (i >= 0) state.sessions[i] = s; else state.sessions.push(s);
  sortSessions(state.sessions);
}

async function requestPersist() {
  try { if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch { /* ignore */ }
}

const isStandalone = () => window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

// ======================================================================
// Aba Treino
// ======================================================================
function treinoHome() {
  return {
    title: 'Treino',
    render(root) {
      if (!isStandalone()) {
        root.append(h('div', { class: 'card small' },
          h('b', null, 'Instale no iPhone: '),
          'no Safari, toque em Compartilhar → "Adicionar à Tela de Início". Use sempre pelo ícone instalado (os dados do Safari e do app instalado são separados).'));
      }

      if (state.draft) {
        const d = state.draft;
        root.append(h('div', { class: 'card highlight' },
          h('div', { class: 'card-title' }, 'Treino em andamento'),
          h('div', { class: 'muted small' }, `${d.templateName} · ${fmtDate(d.date)} · ${countDraftDone(d)} séries feitas`),
          h('div', { class: 'row mt' },
            h('button', { class: 'btn primary grow', onclick: () => go(sessionView(state.draft, { draft: true })) }, 'Continuar'),
            h('button', { class: 'btn ghost danger', onclick: discardDraft }, 'Descartar'))));
      }

      root.append(h('div', { class: 'section' }, 'Seus treinos'));
      const next = nextTemplateId();
      if (!state.templates.length) {
        root.append(h('div', { class: 'empty' }, h('b', null, 'Nenhum treino'), 'Crie seu primeiro treino abaixo.'));
      }
      for (const t of state.templates) {
        const last = state.sessions.find((s) => s.templateId === t.id);
        const isNext = t.id === next && !state.draft;
        root.append(h('div', { class: 'card tpl' + (isNext ? ' next' : '') },
          h('div', { class: 'tpl-head' },
            h('div', { class: 'badge big' }, t.short || t.name.slice(0, 1)),
            h('div', { class: 'grow' },
              h('div', { class: 'card-title' }, t.name, isNext ? h('span', { class: 'pill' }, 'próximo') : null),
              h('div', { class: 'muted small' },
                `${t.exercises.length} exercício${t.exercises.length === 1 ? '' : 's'} · ` + (last ? `último ${relDays(last.date)}` : 'ainda não feito'))),
            h('button', { class: 'icon-btn', 'aria-label': 'Editar treino', onclick: () => go(templateEditor(t)) }, icon('edit'))),
          h('button', { class: 'btn block' + (isNext || !next ? ' primary' : ''), onclick: () => startSession(t) }, 'Iniciar')));
      }
      root.append(h('button', { class: 'btn ghost block', onclick: () => go(templateEditor(null)) }, '+ Novo treino'));
    },
  };
}

const countDraftDone = (d) => d.exercises.reduce((n, e) => n + e.sets.filter((x) => x.done).length, 0);

async function discardDraft() {
  if (!confirm('Descartar o treino em andamento? As séries registradas serão perdidas.')) return;
  await db.del('kv', 'draft');
  state.draft = null;
  state.rest = null;
  state.stack = [];
  render();
}

async function startSession(t) {
  if (!t.exercises.length) {
    toast('Adicione exercícios a este treino primeiro');
    go(templateEditor(t));
    return;
  }
  if (state.draft && !confirm('Já existe um treino em andamento. Descartar e iniciar outro?')) return;
  const sess = {
    id: uid(),
    date: todayISO(),
    templateId: t.id,
    templateName: t.name,
    short: t.short || t.name.slice(0, 1),
    startedAt: Date.now(),
    finishedAt: null,
    notes: '',
    exercises: t.exercises.map((e) => newSessionExercise(e.name, e.sets, e.reps)),
  };
  state.draft = sess;
  state.rest = null;
  await db.put('kv', sess, 'draft');
  go(sessionView(sess, { draft: true }));
}

function newSessionExercise(name, sets = 3, reps = '') {
  const n = Math.max(1, Number(sets) || 1);
  return {
    name: name.trim(),
    key: normName(name),
    target: { sets: n, reps: reps || '' },
    sets: Array.from({ length: n }, () => ({ w: null, r: null, done: false })),
  };
}

// ----------------------------------------------------------------------
// Tela da sessão (novo treino = rascunho; ou edição de treino salvo)
// ----------------------------------------------------------------------
function sessionView(sess, { draft }) {
  let dirty = false;
  const saveDraft = debounce(() => db.put('kv', sess, 'draft'), 300);
  const touch = () => { if (draft) saveDraft(); else dirty = true; };
  let listEl;

  const view = {
    get title() { return sess.templateName; },
    get actions() { return [{ label: draft ? 'Finalizar' : 'Salvar', primary: true, onclick: finish }]; },
    beforeLeave() {
      if (draft) { saveDraft.flush(); return true; }
      return !dirty || confirm('Descartar as alterações?');
    },
    render(root) {
      const restPill = h('button', { class: 'rest-pill', hidden: true, onclick: () => { state.rest = null; tick(); } });
      const tick = () => {
        if (!state.rest) { restPill.hidden = true; return; }
        restPill.hidden = false;
        restPill.textContent = `Descanso ${fmtDuration(Date.now() - state.rest)}`;
      };
      view.startRest = () => { state.rest = Date.now(); tick(); };
      tick();
      ticker = setInterval(tick, 1000);

      root.append(h('div', { class: 'sess-head' },
        h('input', { class: 'input', type: 'date', value: sess.date, onchange: (e) => { sess.date = e.target.value || todayISO(); touch(); } }),
        restPill));

      listEl = h('div');
      root.append(listEl);
      renderList();

      // adicionar exercício avulso
      const addIn = h('input', { class: 'input', placeholder: 'Adicionar exercício…', list: 'ex-names', enterkeyhint: 'done' });
      const add = () => {
        const name = addIn.value.trim();
        if (!name) return;
        sess.exercises.push(newSessionExercise(name, 3, ''));
        addIn.value = '';
        touch();
        renderList();
      };
      addIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
      root.append(exDatalist(), h('div', { class: 'row' }, addIn, h('button', { class: 'btn', onclick: add }, '+')));

      root.append(h('label', { class: 'field mt' }, h('span', null, 'Observações'),
        h('textarea', { class: 'input', placeholder: 'Como foi o treino?', oninput: (e) => { sess.notes = e.target.value; touch(); } }, sess.notes || '')));

      root.append(h('button', { class: 'btn primary block', onclick: finish }, draft ? 'Finalizar treino' : 'Salvar alterações'));
      if (draft) root.append(h('button', { class: 'btn ghost danger block', onclick: discardDraft }, 'Descartar treino'));
    },
  };

  function renderList() {
    listEl.replaceChildren(...sess.exercises.map((ex, i) => exCard(ex, i)));
  }

  function exCard(ex, idx) {
    const card = h('div', { class: 'card ex' });
    const last = lastPerf(ex.key, sess.id);

    const build = () => {
      const target = [ex.target?.sets ? `${ex.target.sets}×` : '', ex.target?.reps || ''].join('').replace(/×$/, ' séries');
      card.replaceChildren(
        h('div', { class: 'ex-head' },
          h('div', { class: 'grow' },
            h('div', { class: 'card-title' }, ex.name),
            h('div', { class: 'ex-last' },
              target ? `Meta ${target}` : null,
              target && last ? ' · ' : null,
              last ? `Última (${fmtShort(last.date)}): ${setsText(last.sets)}` : (target ? null : 'Primeira vez'))),
          h('button', { class: 'icon-btn', 'aria-label': 'Opções', onclick: () => card.classList.toggle('show-tools') }, icon('more'))),
        h('div', { class: 'ex-tools' },
          h('button', { class: 'btn small', disabled: idx === 0, onclick: () => move(idx, -1) }, '↑ Subir'),
          h('button', { class: 'btn small', disabled: idx === sess.exercises.length - 1, onclick: () => move(idx, 1) }, '↓ Descer'),
          h('button', { class: 'btn small danger', onclick: () => { if (confirm(`Remover "${ex.name}" deste treino?`)) { sess.exercises.splice(idx, 1); touch(); renderList(); } } }, 'Remover')),
        h('div', { class: 'set-labels' }, h('span', null, '#'), h('span', null, 'kg'), h('span'), h('span', null, 'reps'), h('span')),
        ...ex.sets.map((st, j) => setRow(ex, st, j, last, build)),
        h('div', { class: 'row' },
          h('button', { class: 'btn small ghost', onclick: () => { ex.sets.push({ w: null, r: null, done: false }); touch(); build(); } }, '+ série'),
          ex.sets.length > 1 ? h('button', { class: 'btn small ghost danger', onclick: () => { ex.sets.pop(); touch(); build(); } }, '− série') : null),
      );
    };
    build();
    return card;
  }

  function move(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= sess.exercises.length) return;
    [sess.exercises[i], sess.exercises[j]] = [sess.exercises[j], sess.exercises[i]];
    touch();
    renderList();
  }

  function placeholderFor(ex, j, last) {
    const ls = last?.sets || [];
    const prev = j > 0 ? ex.sets[j - 1] : null;
    const w = (prev?.done ? prev.w : null) ?? ls[j]?.w ?? ls[ls.length - 1]?.w ?? prev?.w ?? null;
    const r = ls[j]?.r ?? (prev?.done ? prev.r : null) ?? ls[ls.length - 1]?.r ?? null;
    return { w, r };
  }

  function setRow(ex, st, j, last, rebuild) {
    const ph = placeholderFor(ex, j, last);
    const wIn = h('input', {
      class: 'num', type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': `Carga série ${j + 1}`,
      placeholder: ph.w != null ? fmtNum(ph.w) : '–', value: st.w != null ? fmtNum(st.w) : '',
      oninput: (e) => { st.w = parseNum(e.target.value); touch(); },
    });
    const rIn = h('input', {
      class: 'num', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off', 'aria-label': `Repetições série ${j + 1}`,
      placeholder: ph.r != null ? String(ph.r) : '–', value: st.r != null ? String(st.r) : '',
      oninput: (e) => { st.r = parseNum(e.target.value); touch(); },
    });
    const onCheck = () => {
      if (!st.done) {
        if (st.w == null && wIn.value === '' && ph.w != null) st.w = ph.w;
        if (st.r == null && rIn.value === '' && ph.r != null) st.r = ph.r;
        if (st.r == null) { toast('Informe as repetições'); rIn.focus(); return; }
        st.done = true;
        view.startRest?.();
      } else {
        st.done = false;
      }
      touch();
      rebuild();
    };
    return h('div', { class: 'set-row' + (st.done ? ' done' : '') },
      h('span', { class: 'set-n' }, j + 1), wIn, h('span', { class: 'x' }, '×'), rIn,
      h('button', { class: 'check', 'aria-label': `Concluir série ${j + 1}`, onclick: onCheck }, '✓'));
  }

  async function finish() {
    const out = clone(sess);
    out.exercises = out.exercises
      .map((e) => ({ ...e, sets: e.sets.filter((s) => s.done || s.r != null).map((s) => ({ ...s, done: true })) }))
      .filter((e) => e.sets.length);
    if (!out.exercises.length && !confirm('Nenhuma série registrada. Salvar mesmo assim?')) return;
    if (draft) out.finishedAt = Date.now();
    saveDraft.cancel();
    await db.put('sessions', out);
    upsertSession(out);
    dirty = false;
    if (draft) {
      await db.del('kv', 'draft');
      state.draft = null;
      state.rest = null;
      requestPersist();
      toast(`Treino salvo · ${countSets(out)} séries`);
      state.tab = 'treino';
      state.stack = [];
    } else {
      toast('Alterações salvas');
      state.stack.pop();
    }
    render();
  }

  return view;
}

// ----------------------------------------------------------------------
// Editor de treino (template)
// ----------------------------------------------------------------------
function templateEditor(tpl) {
  const isNew = !tpl;
  const t = tpl ? clone(tpl) : { id: uid(), name: '', short: '', order: state.templates.length, exercises: [] };
  let dirty = false;
  const touch = () => { dirty = true; };
  let listEl;

  const view = {
    title: isNew ? 'Novo treino' : 'Editar treino',
    actions: [{ label: 'Salvar', primary: true, onclick: save }],
    beforeLeave() { return !dirty || confirm('Descartar as alterações?'); },
    render(root) {
      root.append(h('div', { class: 'card' },
        h('div', { class: 'row' },
          h('label', { class: 'field grow' }, h('span', null, 'Nome'),
            h('input', { class: 'input', value: t.name, placeholder: 'Ex.: Treino A', oninput: (e) => { t.name = e.target.value; touch(); } })),
          h('label', { class: 'field', style: 'width:84px' }, h('span', null, 'Sigla'),
            h('input', { class: 'input', value: t.short, maxlength: 3, placeholder: 'A', style: 'text-align:center', oninput: (e) => { t.short = e.target.value.trim(); touch(); } })))));

      root.append(h('div', { class: 'section' }, 'Exercícios'));
      listEl = h('div');
      root.append(exDatalist(), listEl);
      renderList();

      root.append(h('button', {
        class: 'btn block', onclick: () => {
          t.exercises.push({ id: uid(), name: '', sets: 3, reps: '8-12' });
          touch(); renderList();
          const inputs = listEl.querySelectorAll('input.ex-name');
          inputs[inputs.length - 1]?.focus();
        },
      }, '+ Adicionar exercício'));
      root.append(h('p', { class: 'muted small' }, 'Dica: mantenha sempre o mesmo nome do exercício. O histórico e os gráficos são agrupados pelo nome.'));

      if (!isNew) {
        root.append(h('button', { class: 'btn ghost danger block', onclick: remove }, 'Excluir este treino'));
      }
    },
  };

  function renderList() {
    if (!t.exercises.length) {
      listEl.replaceChildren(h('div', { class: 'empty' }, 'Nenhum exercício ainda.'));
      return;
    }
    listEl.replaceChildren(...t.exercises.map((e, i) => h('div', { class: 'card' },
      h('div', { class: 'tpl-ex' },
        h('input', { class: 'input ex-name', list: 'ex-names', value: e.name, placeholder: 'Exercício', oninput: (ev) => { e.name = ev.target.value; touch(); } }),
        h('input', { class: 'input', inputmode: 'numeric', pattern: '[0-9]*', value: String(e.sets ?? 3), style: 'text-align:center', 'aria-label': 'Séries', oninput: (ev) => { e.sets = parseInt(ev.target.value, 10) || 1; touch(); } }),
        h('input', { class: 'input', value: e.reps || '', placeholder: '8-12', style: 'text-align:center', 'aria-label': 'Repetições', oninput: (ev) => { e.reps = ev.target.value.trim(); touch(); } })),
      h('div', { class: 'tpl-ex-tools' },
        h('span', { class: 'muted small grow' }, 'séries × reps'),
        h('button', { class: 'icon-btn', disabled: i === 0, 'aria-label': 'Subir', onclick: () => mv(i, -1) }, icon('up')),
        h('button', { class: 'icon-btn', disabled: i === t.exercises.length - 1, 'aria-label': 'Descer', onclick: () => mv(i, 1) }, icon('down')),
        h('button', { class: 'icon-btn danger', 'aria-label': 'Remover', onclick: () => { t.exercises.splice(i, 1); touch(); renderList(); } }, icon('x'))))));
  }

  function mv(i, d) {
    const j = i + d;
    [t.exercises[i], t.exercises[j]] = [t.exercises[j], t.exercises[i]];
    touch(); renderList();
  }

  async function save() {
    t.name = t.name.trim();
    if (!t.name) { toast('Dê um nome ao treino'); return; }
    if (!t.short) t.short = t.name.replace(/^treino\s+/i, '').slice(0, 2).toUpperCase();
    t.exercises = t.exercises.map((e) => ({ ...e, name: e.name.trim() })).filter((e) => e.name);
    await db.put('templates', t);
    const i = state.templates.findIndex((x) => x.id === t.id);
    if (i >= 0) state.templates[i] = t; else state.templates.push(t);
    state.templates.sort((a, b) => a.order - b.order);
    dirty = false;
    toast('Treino salvo');
    state.stack.pop();
    render();
  }

  async function remove() {
    if (!confirm(`Excluir "${t.name}"? O histórico de treinos feitos continua salvo.`)) return;
    await db.del('templates', t.id);
    state.templates = state.templates.filter((x) => x.id !== t.id);
    dirty = false;
    state.stack.pop();
    render();
  }

  return view;
}

// ======================================================================
// Aba Histórico
// ======================================================================
function historicoView() {
  return {
    title: 'Histórico',
    render(root) {
      const now = new Date();
      if (!state.histMonth) state.histMonth = { y: now.getFullYear(), m: now.getMonth() };
      const { y, m } = state.histMonth;

      // estatísticas
      const prefix = `${y}-${pad(m + 1)}`;
      const inMonth = state.sessions.filter((s) => s.date.startsWith(prefix)).length;
      const last28 = state.sessions.filter((s) => { const d = daysAgo(s.date); return d >= 0 && d < 28; }).length;
      root.append(h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('b', null, inMonth), h('span', null, `treinos em ${MONTHS[m]}`)),
        h('div', { class: 'stat' }, h('b', null, fmtNum(last28 / 4, 1)), h('span', null, 'por semana (últimas 4)'))));

      // calendário
      const byDate = new Map();
      for (const s of state.sessions) { if (!byDate.has(s.date)) byDate.set(s.date, []); byDate.get(s.date).push(s); }
      const first = new Date(y, m, 1);
      const nDays = new Date(y, m + 1, 0).getDate();
      const today = todayISO();
      const cells = WEEKDAYS.map((w) => h('div', { class: 'wd' }, w.slice(0, 1).toUpperCase()));
      for (let i = 0; i < first.getDay(); i++) cells.push(h('div'));
      for (let d = 1; d <= nDays; d++) {
        const iso = toISO(new Date(y, m, d));
        const ss = byDate.get(iso);
        cells.push(h('button', {
          class: 'day' + (ss ? ' has' : '') + (iso === today ? ' today' : ''),
          disabled: !ss,
          onclick: ss ? () => go(sessionDetail(ss[0].id)) : null,
        }, d, ss ? h('small', null, ss.map((s) => s.short).join('·')) : null));
      }
      const shift = (k) => { const dt = new Date(y, m + k, 1); state.histMonth = { y: dt.getFullYear(), m: dt.getMonth() }; rerender(); };
      root.append(h('div', { class: 'card mt' },
        h('div', { class: 'cal-head' },
          h('button', { class: 'icon-btn', 'aria-label': 'Mês anterior', onclick: () => shift(-1) }, icon('left')),
          h('b', null, `${MONTHS[m]} ${y}`),
          h('button', { class: 'icon-btn', 'aria-label': 'Próximo mês', onclick: () => shift(1) }, icon('chev'))),
        h('div', { class: 'cal' }, cells)));

      root.append(h('button', { class: 'btn block', onclick: () => go(exerciseListView()) }, 'Progresso por exercício'));

      root.append(h('div', { class: 'section' }, 'Treinos registrados'));
      if (!state.sessions.length) {
        root.append(h('div', { class: 'empty' }, h('b', null, 'Nada por aqui ainda'), 'Seus treinos finalizados aparecem aqui.'));
        return;
      }
      root.append(h('div', { class: 'list' }, state.sessions.map((s) =>
        h('button', { class: 'list-item', onclick: () => go(sessionDetail(s.id)) },
          h('div', { class: 'badge' }, s.short || '•'),
          h('div', { class: 'grow' },
            h('div', { class: 'li-title' }, s.templateName),
            h('div', { class: 'li-sub' }, `${fmtDate(s.date)} · ${weekday(s.date)} · ${countSets(s)} séries`)),
          icon('chev')))));
    },
  };
}

function sessionDetail(id) {
  const find = () => state.sessions.find((x) => x.id === id);
  return {
    get title() { return find()?.templateName || 'Treino'; },
    get actions() { return [{ label: 'Editar', onclick: () => { const s = find(); if (s) go(sessionView(clone(s), { draft: false })); } }]; },
    render(root) {
      const s = find();
      if (!s) { root.append(h('div', { class: 'empty' }, 'Treino não encontrado.')); return; }
      const dur = s.startedAt && s.finishedAt ? s.finishedAt - s.startedAt : 0;
      const vol = volume(s);
      root.append(h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('b', null, fmtShort(s.date)), h('span', null, weekday(s.date))),
        h('div', { class: 'stat' }, h('b', null, countSets(s)), h('span', null, 'séries')),
        vol ? h('div', { class: 'stat' }, h('b', null, fmtNum(vol, 0)), h('span', null, 'kg de volume')) : null,
        dur > 3 * 60e3 && dur < 6 * 3600e3 ? h('div', { class: 'stat' }, h('b', null, `${Math.round(dur / 60e3)} min`), h('span', null, 'duração')) : null));

      for (const e of s.exercises) {
        root.append(h('div', { class: 'card mt' },
          h('div', { class: 'row between' },
            h('div', { class: 'card-title' }, e.name),
            h('button', { class: 'btn small ghost', onclick: () => go(exerciseChart(e.key)) }, 'Progresso')),
          e.sets.map((st, i) => h('div', { class: 'detail-set' },
            h('span', { class: 'muted' }, `Série ${i + 1}`),
            h('span', null, st.w != null ? `${fmtNum(st.w)} kg × ${st.r}` : `${st.r} reps`)))));
      }
      if (s.notes) root.append(h('div', { class: 'card' }, h('div', { class: 'muted small' }, 'Observações'), s.notes));

      root.append(h('button', {
        class: 'btn ghost danger block', onclick: async () => {
          if (!confirm('Excluir este treino do histórico?')) return;
          await db.del('sessions', s.id);
          state.sessions = state.sessions.filter((x) => x.id !== s.id);
          toast('Treino excluído');
          state.stack.pop();
          render();
        },
      }, 'Excluir treino'));
    },
  };
}

function exerciseListView() {
  let q = '';
  return {
    title: 'Exercícios',
    render(root) {
      const map = new Map();
      for (const s of state.sessions) {
        for (const e of s.exercises) {
          if (!map.has(e.key)) map.set(e.key, { key: e.key, name: e.name, count: 0, last: s.date });
          map.get(e.key).count++;
        }
      }
      const all = [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
      if (!all.length) { root.append(h('div', { class: 'empty' }, h('b', null, 'Sem dados'), 'Finalize um treino para ver o progresso.')); return; }
      const listEl = h('div', { class: 'list' });
      const draw = () => {
        const nq = normName(q);
        listEl.replaceChildren(...all.filter((x) => x.key.includes(nq)).map((x) =>
          h('button', { class: 'list-item', onclick: () => go(exerciseChart(x.key)) },
            h('div', { class: 'grow' }, h('div', { class: 'li-title' }, x.name), h('div', { class: 'li-sub' }, `${x.count} treinos · último ${relDays(x.last)}`)),
            icon('chev'))));
      };
      root.append(h('input', { class: 'input', type: 'search', placeholder: 'Buscar exercício', style: 'margin-bottom:12px', oninput: (e) => { q = e.target.value; draw(); } }), listEl);
      draw();
    },
  };
}

function exerciseChart(key) {
  let metric = 'max';
  const METRICS = {
    max: { label: 'Carga', unit: 'kg', f: (sets) => maxOrNull(sets.map((s) => s.w)) },
    e1rm: { label: '1RM est.', unit: 'kg', f: (sets) => maxOrNull(sets.map((s) => (s.w && s.r ? s.w * (1 + s.r / 30) : null))) },
    vol: { label: 'Volume', unit: 'kg', f: (sets) => { const v = sets.reduce((a, s) => a + (s.w && s.r ? s.w * s.r : 0), 0); return v || null; } },
    reps: { label: 'Reps', unit: 'reps', f: (sets) => maxOrNull(sets.map((s) => s.r)) },
  };
  const hist = () => state.sessions
    .map((s) => ({ date: s.date, ex: s.exercises.find((e) => e.key === key) }))
    .filter((x) => x.ex);

  return {
    get title() { return hist()[0]?.ex.name || 'Exercício'; },
    render(root) {
      const items = hist();
      if (!items.length) { root.append(h('div', { class: 'empty' }, 'Sem registros.')); return; }
      const best = items.reduce((b, x) => { const v = METRICS.max.f(x.ex.sets); return v != null && (!b || v > b.v) ? { v, date: x.date } : b; }, null);

      root.append(h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('b', null, best ? `${fmtNum(best.v)} kg` : '–'), h('span', null, best ? `recorde · ${fmtShort(best.date)}` : 'sem carga registrada')),
        h('div', { class: 'stat' }, h('b', null, items.length), h('span', null, 'treinos'))));

      const chartBox = h('div', { class: 'card mt' });
      const seg = h('div', { class: 'seg' });
      const draw = () => {
        seg.replaceChildren(...Object.entries(METRICS).map(([k, m]) =>
          h('button', { class: k === metric ? 'on' : '', onclick: () => { metric = k; draw(); } }, m.label)));
        const M = METRICS[metric];
        const pts = items.slice().reverse()
          .map((x) => ({ label: fmtShort(x.date), y: M.f(x.ex.sets) }))
          .filter((p) => p.y != null)
          .slice(-30);
        chartBox.replaceChildren(seg, lineChart(pts, { unit: M.unit }));
        if (metric === 'e1rm') chartBox.append(h('div', { class: 'muted small' }, '1RM estimado pela fórmula de Epley: carga × (1 + reps/30).'));
      };
      draw();
      root.append(chartBox);

      root.append(h('div', { class: 'section' }, 'Registros'));
      root.append(h('div', { class: 'list' }, items.map((x) =>
        h('div', { class: 'list-item' },
          h('div', { class: 'grow' }, h('div', { class: 'li-title' }, fmtDate(x.date)), h('div', { class: 'li-sub' }, setsText(x.ex.sets)))))));
    },
  };
}

function maxOrNull(arr) {
  const v = arr.filter((x) => x != null);
  return v.length ? Math.max(...v) : null;
}

// ======================================================================
// Aba Dieta (etapa 2)
// ======================================================================
function dietaView() {
  return {
    title: 'Dieta',
    render(root) {
      root.append(h('div', { class: 'empty' },
        h('b', null, 'Em construção'),
        'O módulo de dieta (TACO, receitas, refeições, meta de kcal, código de barras e scan da tabela nutricional) chega na próxima etapa.'));
    },
  };
}

// ======================================================================
// Aba Ajustes
// ======================================================================
function ajustesView() {
  return {
    title: 'Ajustes',
    async render(root) {
      // Treinos
      root.append(h('div', { class: 'section' }, 'Treinos'));
      root.append(h('div', { class: 'list' },
        state.templates.map((t) => h('button', { class: 'list-item', onclick: () => go(templateEditor(t)) },
          h('div', { class: 'badge' }, t.short), h('div', { class: 'grow' }, h('div', { class: 'li-title' }, t.name), h('div', { class: 'li-sub' }, `${t.exercises.length} exercícios`)), icon('chev'))),
        h('button', { class: 'list-item', onclick: () => go(templateEditor(null)) }, h('div', { class: 'li-title', style: 'color:var(--accent)' }, '+ Novo treino'))));

      // Backup
      const lb = state.lastBackup;
      const lbDays = lb ? Math.floor((Date.now() - lb) / 86400000) : null;
      root.append(h('div', { class: 'section' }, 'Backup'));
      root.append(h('div', { class: 'card' },
        h('div', { class: 'small ' + (lbDays == null || lbDays > 14 ? 'warn' : 'muted') },
          lb ? `Último backup: ${lbDays === 0 ? 'hoje' : `há ${lbDays} dia${lbDays === 1 ? '' : 's'}`}` : 'Nenhum backup feito ainda'),
        h('p', { class: 'muted small' }, 'Os dados ficam só neste iPhone. Exporte um backup de vez em quando e salve no app Arquivos/iCloud.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary grow', onclick: exportBackup }, 'Exportar'),
          h('button', { class: 'btn grow', onclick: () => pickFile('.json,application/json', importBackup) }, 'Restaurar'))));

      // CSV
      root.append(h('div', { class: 'section' }, 'Importar planilha'));
      root.append(h('div', { class: 'card' },
        h('p', { class: 'muted small', style: 'margin-top:0' }, 'Importe treinos antigos de um CSV (vírgula ou ponto e vírgula). Uma linha por série:'),
        h('pre', { class: 'code' }, 'data;treino;exercicio;carga;reps\n03/11/2026;A;Supino reto;40;10\n03/11/2026;A;Supino reto;40;9'),
        h('p', { class: 'muted small' }, 'A coluna "treino" pode ser a sigla (A) ou o nome (Treino A). Treinos com mesma data e treino já existentes são ignorados.'),
        h('button', { class: 'btn block', onclick: () => pickFile('.csv,text/csv,text/plain', importCSVFile) }, 'Escolher arquivo CSV')));

      // Armazenamento
      root.append(h('div', { class: 'section' }, 'Armazenamento'));
      const storeCard = h('div', { class: 'card' });
      root.append(storeCard);
      let persisted = null, usage = null;
      try { persisted = await navigator.storage?.persisted?.(); } catch { /* */ }
      try { const e = await navigator.storage?.estimate?.(); usage = e?.usage; } catch { /* */ }
      storeCard.append(
        h('div', { class: 'set-item' }, h('span', null, 'Armazenamento protegido'),
          persisted ? h('b', { style: 'color:var(--ok)' }, 'Sim')
            : h('button', { class: 'btn small', onclick: async () => { await requestPersist(); rerender(); } }, persisted === false ? 'Solicitar' : 'Indisponível')),
        h('div', { class: 'set-item' }, h('span', null, 'Treinos salvos'), h('b', null, state.sessions.length)),
        usage != null ? h('div', { class: 'set-item' }, h('span', null, 'Espaço usado'), h('b', null, `${fmtNum(usage / 1024 / 1024, 1)} MB`)) : null,
        h('div', { class: 'set-item' }, h('span', null, 'Modo'), h('b', null, isStandalone() ? 'App instalado' : 'Navegador')));

      // Zona de perigo
      root.append(h('div', { class: 'section' }, 'Zona de perigo'));
      root.append(h('button', {
        class: 'btn danger block', style: 'margin-top:0', onclick: async () => {
          if (!confirm('Apagar TODOS os dados do app? Isso não pode ser desfeito.')) return;
          if (!confirm('Tem certeza? Recomendo exportar um backup antes.')) return;
          await db.wipe();
          await seed();
          await loadAll();
          toast('Dados apagados');
          render();
        },
      }, 'Apagar todos os dados'));

      root.append(h('p', { class: 'muted small center mt' }, `Rodela Track v${APP_VERSION}`));
    },
  };
}

function pickFile(accept, cb) {
  const inp = h('input', { type: 'file', accept, style: 'display:none' });
  inp.addEventListener('change', () => { const f = inp.files?.[0]; inp.remove(); if (f) cb(f); });
  document.body.append(inp);
  inp.click();
}

function buildBackup() {
  return { app: 'rodela-track', schema: 1, version: APP_VERSION, exportedAt: new Date().toISOString(), templates: state.templates, sessions: state.sessions };
}

async function markBackup() {
  state.lastBackup = Date.now();
  await db.put('kv', state.lastBackup, 'lastBackup');
  rerender();
}

async function exportBackup() {
  // monta tudo de forma síncrona para manter o "gesto do usuário" exigido pelo iOS no share
  const json = JSON.stringify(buildBackup());
  const name = `rodela-track-backup-${todayISO()}.json`;
  const file = new File([json], name, { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Backup Rodela Track' });
      await markBackup();
      toast('Backup exportado');
      return;
    }
  } catch (e) {
    if (e.name === 'AbortError') return;
  }
  const url = URL.createObjectURL(file);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  await markBackup();
  toast('Backup exportado');
}

async function importBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { toast('Arquivo inválido'); return; }
  if (data?.app !== 'rodela-track' || !Array.isArray(data.sessions)) { toast('Este arquivo não é um backup do Rodela Track'); return; }
  const when = data.exportedAt ? new Date(data.exportedAt).toLocaleDateString('pt-BR') : '?';
  if (!confirm(`Restaurar backup de ${when}?\n${data.sessions.length} treinos, ${data.templates?.length || 0} modelos.\n\nIsso SUBSTITUI os dados atuais.`)) return;
  await db.replaceAll({ templates: data.templates || [], sessions: data.sessions });
  await loadAll();
  toast('Backup restaurado');
  render();
}

// ---------- CSV ----------
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/)[0];
  const count = (c) => firstLine.split(c).length;
  const delim = count('\t') > 1 ? '\t' : count(';') >= count(',') ? ';' : ',';
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

function parseDateAny(s) {
  s = (s || '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${pad(m[2])}-${pad(m[1])}`; }
  return null;
}

function matchTemplate(name) {
  const n = normName(name);
  if (!n) return null;
  return state.templates.find((t) => normName(t.name) === n || normName(t.short) === n || normName(`treino ${t.short}`) === n) || null;
}

async function importCSVFile(file) {
  try {
    const rows = parseCSV(await file.text());
    if (rows.length < 2) throw new Error('Arquivo vazio');
    const head = rows[0].map(normName);
    const col = (...names) => head.findIndex((x) => names.some((n) => x === n || x.startsWith(n)));
    const ci = { data: col('data', 'date'), treino: col('treino', 'workout'), ex: col('exercicio', 'exercise'), carga: col('carga', 'peso', 'kg'), reps: col('reps', 'repeticoes') };
    if (ci.data < 0 || ci.ex < 0 || ci.reps < 0) throw new Error('Colunas obrigatórias: data, exercicio, reps');

    const groups = new Map();
    let nSets = 0, skipped = 0;
    for (const r of rows.slice(1)) {
      const date = parseDateAny(r[ci.data]);
      const exName = (r[ci.ex] || '').trim();
      const reps = parseNum(r[ci.reps]);
      if (!date || !exName || reps == null) { skipped++; continue; }
      const tName = ci.treino >= 0 ? (r[ci.treino] || '').trim() : '';
      const gk = `${date}|${normName(tName)}`;
      if (!groups.has(gk)) groups.set(gk, { date, tName, ex: new Map() });
      const g = groups.get(gk);
      const k = normName(exName);
      if (!g.ex.has(k)) g.ex.set(k, { name: exName, key: k, target: {}, sets: [] });
      g.ex.get(k).sets.push({ w: ci.carga >= 0 ? parseNum(r[ci.carga]) : null, r: reps, done: true });
      nSets++;
    }

    const existing = new Set(state.sessions.map((s) => `${s.date}|${normName(s.templateName)}`));
    const sessions = [];
    let dup = 0;
    for (const g of groups.values()) {
      const tpl = matchTemplate(g.tName);
      const templateName = tpl?.name || g.tName || 'Treino';
      if (existing.has(`${g.date}|${normName(templateName)}`)) { dup++; continue; }
      sessions.push({
        id: uid(), date: g.date, templateId: tpl?.id || null, templateName,
        short: tpl?.short || (g.tName ? g.tName.slice(0, 2).toUpperCase() : '•'),
        startedAt: null, finishedAt: null, notes: '', imported: true, exercises: [...g.ex.values()],
      });
    }
    if (!sessions.length) { toast(dup ? 'Todos os treinos do arquivo já existem' : 'Nenhuma linha válida encontrada'); return; }
    const msg = `Importar ${sessions.length} treinos (${nSets} séries)?` + (dup ? `\n${dup} já existiam e serão ignorados.` : '') + (skipped ? `\n${skipped} linhas inválidas ignoradas.` : '');
    if (!confirm(msg)) return;
    await db.putMany('sessions', sessions);
    sessions.forEach(upsertSession);
    toast(`${sessions.length} treinos importados`);
    rerender();
  } catch (e) {
    toast(`Erro no CSV: ${e.message}`);
  }
}

// ======================================================================
// Service Worker (offline + atualização)
// ======================================================================
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  const banner = document.getElementById('update-banner');
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    const show = () => {
      banner.hidden = false;
      document.getElementById('update-btn').onclick = () => reg.waiting?.postMessage('skipWaiting');
    };
    if (reg.waiting && navigator.serviceWorker.controller) show();
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) show(); });
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => {});
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    if (state.draft) db.put('kv', state.draft, 'draft').finally(() => location.reload());
    else location.reload();
  });
}

boot().catch((e) => {
  console.error(e);
  $view.replaceChildren(h('div', { class: 'empty' }, h('b', null, 'Erro ao iniciar'), String(e?.message || e)));
});
