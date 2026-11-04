// Rodela Track — módulo Dieta
import * as db from './db.js';
import { h, toast, todayISO, toISO, parseISO, fmtDate, fmtShort, weekday, parseNum, fmtNum, uid, normName, clone } from './util.js';
import { parseLabel } from './label.js';

export const DIETA_VERSION = '0.3.2';

export const MEALS = [
  { id: 'cafe', name: 'Café da manhã' },
  { id: 'almoco', name: 'Almoço' },
  { id: 'lanche', name: 'Lanche da tarde' },
  { id: 'janta', name: 'Janta' },
];
const DEFAULT_GOAL = { kcal: 2500, pc: 40, pp: 30, pf: 30 };
const OFF_URL = (ean) => `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(ean)}.json?fields=product_name,product_name_pt,brands,nutriments,serving_quantity,quantity`;

// ---------- cálculo ----------
const r1 = (x) => Math.round(x * 10) / 10;
export const calc = (n, g) => ({ kcal: (n.kcal || 0) * g / 100, c: (n.c || 0) * g / 100, p: (n.p || 0) * g / 100, f: (n.f || 0) * g / 100 });
const add = (a, b) => ({ kcal: a.kcal + b.kcal, c: a.c + b.c, p: a.p + b.p, f: a.f + b.f });
const ZERO = { kcal: 0, c: 0, p: 0, f: 0 };
const sumItems = (items) => items.reduce((t, it) => add(t, calc(it.n, it.grams)), { ...ZERO });
export function goalGrams(g) {
  return { kcal: g.kcal, c: g.kcal * g.pc / 100 / 4, p: g.kcal * g.pp / 100 / 4, f: g.kcal * g.pf / 100 / 9 };
}
function recipeTotals(r) {
  const tot = sumItems(r.items);
  const raw = r.items.reduce((a, it) => a + (Number(it.grams) || 0), 0);
  const weight = r.finalWeight || raw;
  const per100 = weight ? { kcal: tot.kcal / weight * 100, c: tot.c / weight * 100, p: tot.p / weight * 100, f: tot.f / weight * 100 } : { ...ZERO };
  return { tot, raw, weight, per100 };
}
const macroLine = (t) => `C ${fmtNum(t.c, 0)} · P ${fmtNum(t.p, 0)} · G ${fmtNum(t.f, 0)}`;
const kcalTxt = (k) => `${fmtNum(k, 0)} kcal`;
const SRC_LABEL = { taco: 'TACO', custom: 'Meu alimento', recipe: 'Receita' };

// ---------- carregamento de scripts sob demanda ----------
const loaded = {};
function loadScript(src) {
  if (!loaded[src]) {
    loaded[src] = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => { delete loaded[src]; rej(new Error(`Falha ao carregar ${src}`)); };
      document.head.append(s);
    });
  }
  return loaded[src];
}

export function createDieta(ctx) {
  const { state, go, render, rerender, icon, pickFile } = ctx;
  const D = (state.diet = { foods: [], recipes: [], days: new Map(), goal: { ...DEFAULT_GOAL }, taco: null, day: todayISO() });

  // ======================================================================
  // Dados
  // ======================================================================
  async function load() {
    D.foods = await db.getAll('foods');
    D.recipes = await db.getAll('recipes');
    D.days = new Map((await db.getAll('days')).map((d) => [d.date, d]));
    D.goal = { ...DEFAULT_GOAL, ...((await db.get('kv', 'dietGoal')) || {}) };
  }

  async function loadTaco() {
    if (!D.taco) {
      const res = await fetch('./data/taco.json');
      D.taco = (await res.json()).map((f) => ({ id: f.id, name: f.name, cat: f.cat, src: 'taco', n: { kcal: f.kcal, c: f.c, p: f.p, f: f.f }, _k: normName(f.name) }));
    }
    return D.taco;
  }

  const emptyDay = (date) => ({ date, meals: Object.fromEntries(MEALS.map((m) => [m.id, []])) });
  const getDay = (date) => {
    const d = D.days.get(date);
    if (!d) return emptyDay(date);
    for (const m of MEALS) d.meals[m.id] ||= [];
    return d;
  };
  async function saveDay(day) {
    const empty = MEALS.every((m) => !day.meals[m.id]?.length);
    if (empty) { D.days.delete(day.date); await db.del('days', day.date); }
    else { D.days.set(day.date, day); await db.put('days', day); }
  }

  const recipeAsFood = (r) => { const t = recipeTotals(r); return { id: r.id, name: r.name, src: 'recipe', n: t.per100, recipeWeight: t.weight }; };
  const foodToItem = (food, grams) => ({
    id: uid(), name: food.name, brand: food.brand || '', src: food.src, ref: food.id, grams, n: { ...food.n },
    ...(food.recipeWeight ? { recipeWeight: food.recipeWeight } : {}),
  });
  /** "1 receita", "½ receita", "1,5 receita" */
  function recipeQty(grams, weight) {
    const q = grams / weight;
    if (Math.abs(q - 0.5) < 0.01) return '½ receita';
    const t = fmtNum(q, 2);
    return `${t} ${q > 1.0001 ? 'receitas' : 'receita'}`;
  }

  /** Receita entra inteira (pesos dos ingredientes), sem perguntar quantidade. */
  async function addRecipeDirect(recipeId, target) {
    const r = D.recipes.find((x) => x.id === recipeId);
    if (!r) { toast('Receita não encontrada'); return; }
    const food = recipeAsFood(r);
    const day = getDay(target.date);
    day.meals[target.meal].push(foodToItem(food, food.recipeWeight));
    await saveDay(day);
    toast(`${r.name} adicionada · ${kcalTxt(recipeTotals(r).tot.kcal)}`);
    popUntil(() => false);
  }

  function lastGramsFor(ref) {
    const dates = [...D.days.keys()].sort().reverse();
    for (const d of dates) for (const m of MEALS) {
      const it = D.days.get(d).meals[m.id]?.find((x) => x.ref === ref);
      if (it) return it.grams;
    }
    return null;
  }

  function recents(limit = 15) {
    const out = [], seen = new Set();
    const dates = [...D.days.keys()].sort().reverse();
    for (const d of dates) for (const m of MEALS) for (const it of D.days.get(d).meals[m.id] || []) {
      const k = it.ref || normName(it.name);
      if (seen.has(k)) continue;
      seen.add(k);
      if (it.src === 'recipe' && !D.recipes.some((r) => r.id === it.ref)) continue; // receita excluída
      out.push({ id: it.ref || it.id, name: it.name, brand: it.brand, src: it.src, n: it.n, recipeWeight: it.recipeWeight });
      if (out.length >= limit) return out;
    }
    return out;
  }

  async function searchFoods(q) {
    const toks = normName(q).split(' ').filter(Boolean);
    if (!toks.length) return [];
    const match = (k) => toks.every((t) => k.includes(t));
    const mine = [
      ...D.recipes.map(recipeAsFood),
      ...D.foods.map((f) => ({ ...f, src: 'custom' })),
    ].filter((f) => match(normName(`${f.name} ${f.brand || ''}`)));
    const taco = (await loadTaco()).filter((f) => match(f._k));
    // TACO: prioriza nomes que começam com o 1º termo
    taco.sort((a, b) => (b._k.startsWith(toks[0]) - a._k.startsWith(toks[0])) || a.name.length - b.name.length);
    return [...mine, ...taco].slice(0, 60);
  }

  // ======================================================================
  // Tela do dia
  // ======================================================================
  function dietaView() {
    return {
      title: 'Dieta',
      get actions() { return D.day !== todayISO() ? [{ label: 'Hoje', onclick: () => { D.day = todayISO(); rerender(); } }] : []; },
      render(root) {
        const day = getDay(D.day);
        const shift = (k) => { const d = parseISO(D.day); d.setDate(d.getDate() + k); D.day = toISO(d); render(); };

        // navegação de data
        const dateLbl = D.day === todayISO() ? 'Hoje' : relLabel(D.day);
        root.append(h('div', { class: 'day-nav' },
          h('button', { class: 'icon-btn', 'aria-label': 'Dia anterior', onclick: () => shift(-1) }, icon('left')),
          h('label', { class: 'day-label' },
            h('b', null, dateLbl), h('span', null, `${weekday(D.day)}, ${fmtDate(D.day)}`),
            h('input', { type: 'date', value: D.day, onchange: (e) => { if (e.target.value) { D.day = e.target.value; render(); } } })),
          h('button', { class: 'icon-btn', 'aria-label': 'Próximo dia', onclick: () => shift(1) }, icon('chev'))));

        // resumo
        const tot = MEALS.reduce((t, m) => add(t, sumItems(day.meals[m.id])), { ...ZERO });
        const goal = goalGrams(D.goal);
        const left = goal.kcal - tot.kcal;
        root.append(h('div', { class: 'card' },
          h('div', { class: 'row between' },
            h('div', null, h('div', { class: 'kcal-big' }, fmtNum(tot.kcal, 0), h('small', null, ` / ${fmtNum(goal.kcal, 0)} kcal`))),
            h('div', { class: 'small ' + (left < 0 ? 'warn' : 'muted'), style: 'text-align:right' }, left >= 0 ? `faltam ${fmtNum(left, 0)}` : `${fmtNum(-left, 0)} acima`)),
          bar(tot.kcal, goal.kcal, 'kcal'),
          h('div', { class: 'macros' },
            macroBox('Carbo', tot.c, goal.c, 'c'),
            macroBox('Proteína', tot.p, goal.p, 'p'),
            macroBox('Gordura', tot.f, goal.f, 'f'))));

        for (const m of MEALS) root.append(mealCard(day, m));

        // copiar dia
        const hasAny = MEALS.some((m) => day.meals[m.id].length);
        if (hasAny) {
          root.append(h('div', { class: 'row mt' },
            h('button', { class: 'btn grow', onclick: () => copyItems(day, MEALS.map((m) => m.id), nextDay(D.day)) }, 'Copiar dia → amanhã'),
            h('button', { class: 'btn', onclick: () => go(copyView(day, MEALS.map((m) => m.id), 'o dia inteiro')) }, 'Outra data')));
        }

        root.append(h('div', { class: 'section' }, 'Gerenciar'));
        root.append(h('div', { class: 'list' },
          h('button', { class: 'list-item', onclick: () => go(recipesView()) }, h('div', { class: 'grow li-title' }, 'Receitas'), h('span', { class: 'muted small' }, D.recipes.length), icon('chev')),
          h('button', { class: 'list-item', onclick: () => go(myFoodsView()) }, h('div', { class: 'grow li-title' }, 'Meus alimentos'), h('span', { class: 'muted small' }, D.foods.length), icon('chev')),
          h('button', { class: 'list-item', onclick: () => go(goalView()) }, h('div', { class: 'grow li-title' }, 'Meta diária'), h('span', { class: 'muted small' }, kcalTxt(D.goal.kcal)), icon('chev'))));
      },
    };
  }

  function relLabel(iso) {
    const d = Math.round((parseISO(iso) - parseISO(todayISO())) / 86400000);
    if (d === -1) return 'Ontem';
    if (d === 1) return 'Amanhã';
    return fmtShort(iso);
  }
  const nextDay = (iso) => { const d = parseISO(iso); d.setDate(d.getDate() + 1); return toISO(d); };
  const prevDay = (iso) => { const d = parseISO(iso); d.setDate(d.getDate() - 1); return toISO(d); };

  function bar(v, max, cls) {
    const pct = max > 0 ? Math.min(100, (v / max) * 100) : 0;
    return h('div', { class: `bar ${cls}` + (v > max * 1.05 ? ' over' : '') }, h('i', { style: `width:${pct}%` }));
  }
  function macroBox(label, v, g, cls) {
    return h('div', { class: 'macro' },
      h('div', { class: 'macro-lbl' }, label),
      h('div', { class: 'macro-val' }, fmtNum(v, 0), h('small', null, ` / ${fmtNum(g, 0)} g`)),
      bar(v, g, cls));
  }

  function mealCard(day, m) {
    const items = day.meals[m.id];
    const t = sumItems(items);
    const card = h('div', { class: 'card meal' });
    const yesterday = D.days.get(prevDay(day.date))?.meals[m.id] || [];

    card.append(
      h('div', { class: 'meal-head' },
        h('div', { class: 'grow' },
          h('div', { class: 'card-title' }, m.name),
          items.length ? h('div', { class: 'muted small' }, `${kcalTxt(t.kcal)} · ${macroLine(t)}`) : null),
        items.length ? h('button', { class: 'icon-btn', 'aria-label': 'Opções', onclick: () => card.classList.toggle('show-tools') }, icon('more')) : null),
      h('div', { class: 'ex-tools wrap' },
        h('button', { class: 'btn small', onclick: () => copyItems(day, [m.id], nextDay(day.date)) }, 'Copiar → amanhã'),
        h('button', { class: 'btn small', onclick: () => go(copyView(day, [m.id], m.name)) }, 'Outra data'),
        h('button', { class: 'btn small danger', onclick: async () => { if (!confirm(`Limpar ${m.name}?`)) return; day.meals[m.id] = []; await saveDay(day); rerender(); } }, 'Limpar')),
    );

    for (const it of items) {
      const k = calc(it.n, it.grams);
      const qty = it.recipeWeight ? `${recipeQty(it.grams, it.recipeWeight)} · ${fmtNum(it.grams, 0)} g` : `${fmtNum(it.grams)} g`;
      card.append(h('button', { class: 'food-row', onclick: () => go(qtyView({ food: { id: it.ref, name: it.name, brand: it.brand, src: it.src, n: it.n, recipeWeight: it.recipeWeight }, grams: it.grams, edit: { day, meal: m.id, item: it } })) },
        h('div', { class: 'grow' }, h('div', { class: 'li-title' }, it.name), h('div', { class: 'li-sub' }, `${qty} · ${macroLine(k)}`)),
        h('b', { class: 'small' }, fmtNum(k.kcal, 0))));
    }

    const actions = h('div', { class: 'row mt' },
      h('button', { class: 'btn small ghost', onclick: () => go(addFoodView({ date: day.date, meal: m.id })) }, '+ Adicionar'));
    if (!items.length && yesterday.length) {
      actions.append(h('button', {
        class: 'btn small ghost', onclick: async () => {
          day.meals[m.id] = yesterday.map((it) => ({ ...clone(it), id: uid() }));
          await saveDay(day); toast('Refeição repetida de ontem'); rerender();
        },
      }, `Repetir de ontem (${yesterday.length})`));
    }
    card.append(actions);
    return card;
  }

  async function copyItems(fromDay, mealIds, toDate) {
    if (toDate === fromDay.date) { toast('Escolha outra data'); return; }
    const target = getDay(toDate);
    let n = 0;
    for (const id of mealIds) for (const it of fromDay.meals[id] || []) { target.meals[id].push({ ...clone(it), id: uid() }); n++; }
    if (!n) { toast('Nada para copiar'); return; }
    await saveDay(target);
    toast(`${n} ${n === 1 ? 'item copiado' : 'itens copiados'} para ${fmtShort(toDate)}`);
  }

  function copyView(day, mealIds, what) {
    let date = nextDay(day.date);
    return {
      title: 'Copiar',
      render(root) {
        root.append(h('div', { class: 'card' },
          h('p', { style: 'margin-top:0' }, `Copiar ${what.toLowerCase()} de ${fmtDate(day.date)} para:`),
          h('input', { class: 'input', type: 'date', value: date, onchange: (e) => { date = e.target.value; } }),
          h('p', { class: 'muted small' }, 'Os itens são adicionados ao que já existir na data de destino.'),
          h('button', { class: 'btn primary block', onclick: async () => { if (!date) return; await copyItems(day, mealIds, date); state.stack.pop(); render(); } }, 'Copiar')));
      },
    };
  }

  // ======================================================================
  // Adicionar alimento (busca + atalhos)
  // ======================================================================
  /** target: { date, meal } para diário, ou { pick: (food, grams) => void } para receita */
  function addFoodView(target) {
    let q = '';
    const mealName = target.meal ? MEALS.find((m) => m.id === target.meal).name : null;
    const v = {
      title: mealName || 'Ingrediente',
      render(root) {
        const results = h('div');
        const input = h('input', { class: 'input', type: 'search', placeholder: 'Buscar alimento ou receita', value: q, enterkeyhint: 'search', autocomplete: 'off' });
        let seq = 0;
        const draw = async () => {
          const my = ++seq;
          if (!q.trim()) {
            const rec = recents();
            const blocks = [];
            if (rec.length) blocks.push(h('div', { class: 'section' }, 'Recentes'), foodList(rec));
            if (D.recipes.length && !target.pick) blocks.push(h('div', { class: 'section' }, 'Receitas'), foodList(D.recipes.map(recipeAsFood)));
            if (D.foods.length) blocks.push(h('div', { class: 'section' }, 'Meus alimentos'), foodList(D.foods.map((f) => ({ ...f, src: 'custom' }))));
            if (!blocks.length) blocks.push(h('div', { class: 'empty' }, 'Busque na base TACO (≈600 alimentos) ou use os atalhos acima.'));
            results.replaceChildren(...blocks);
            return;
          }
          const list = await searchFoods(q);
          if (my !== seq) return;
          results.replaceChildren(list.length ? foodList(list) : h('div', { class: 'empty' }, h('b', null, 'Nada encontrado'), 'Tente outro termo ou cadastre manualmente.'));
        };
        input.addEventListener('input', () => { q = input.value; draw(); });

        root.append(input);
        root.append(h('div', { class: 'quick' },
          quickBtn('Código de barras', () => go(barcodeView(target))),
          quickBtn('Foto da tabela', () => pickFile('image/*', (file) => { const ed = foodEditor({ target }); go(ed); ed.runOCR(file); })),
          quickBtn('Colar texto', () => { const ed = foodEditor({ target, paste: true }); go(ed); }),
          quickBtn('Manual', () => go(foodEditor({ target })))));
        root.append(results);
        draw();
      },
    };

    function quickBtn(label, onclick) { return h('button', { class: 'quick-btn', onclick }, label); }

    function foodList(list) {
      return h('div', { class: 'list' }, list.map((f) => {
        const isRecipe = f.src === 'recipe' && !target.pick;
        const r = isRecipe ? D.recipes.find((x) => x.id === f.id) : null;
        const sub = r
          ? `Receita inteira · ${fmtNum(recipeTotals(r).weight, 0)} g · ${kcalTxt(recipeTotals(r).tot.kcal)} · ${macroLine(recipeTotals(r).tot)}`
          : `${SRC_LABEL[f.src] || ''} · 100 g: ${kcalTxt(f.n.kcal)} · ${macroLine(f.n)}`;
        return h('button', { class: 'list-item', onclick: () => (isRecipe ? addRecipeDirect(f.id, target) : go(qtyView({ food: f, target }))) },
        h('div', { class: 'grow' },
          h('div', { class: 'li-title' }, f.name, f.brand ? h('span', { class: 'muted' }, ` · ${f.brand}`) : null),
          h('div', { class: 'li-sub' }, sub)),
          isRecipe ? h('span', { class: 'add-plus', 'aria-hidden': 'true' }, '+') : null,
        isRecipe ? null : icon('chev'));
      }));
    }
    return v;
  }

  // ======================================================================
  // Quantidade
  // ======================================================================
  /** opts: { food, target?, grams?, edit?: {day, meal, item} } */
  function qtyView({ food, target, grams, edit }) {
    let g = grams ?? lastGramsFor(food.id) ?? food.portion ?? 100;
    return {
      title: edit ? 'Editar item' : 'Quantidade',
      render(root) {
        const prev = h('div', { class: 'qty-prev' });
        const upd = () => {
          const t = calc(food.n, g || 0);
          prev.replaceChildren(
            h('div', { class: 'kcal-big center' }, fmtNum(t.kcal, 0), h('small', null, ' kcal')),
            h('div', { class: 'macros' },
              h('div', { class: 'macro' }, h('div', { class: 'macro-lbl' }, 'Carbo'), h('div', { class: 'macro-val' }, `${fmtNum(t.c, 1)} g`)),
              h('div', { class: 'macro' }, h('div', { class: 'macro-lbl' }, 'Proteína'), h('div', { class: 'macro-val' }, `${fmtNum(t.p, 1)} g`)),
              h('div', { class: 'macro' }, h('div', { class: 'macro-lbl' }, 'Gordura'), h('div', { class: 'macro-val' }, `${fmtNum(t.f, 1)} g`))));
        };
        const gIn = h('input', { class: 'input qty-input', inputmode: 'decimal', value: fmtNum(g), oninput: (e) => { g = parseNum(e.target.value); upd(); } });
        const chip = (val, label) => h('button', { class: 'chip', onclick: () => { g = val; gIn.value = fmtNum(val); upd(); } }, label || `${val} g`);

        root.append(h('div', { class: 'card' },
          h('div', { class: 'card-title' }, food.name),
          h('div', { class: 'muted small' }, [SRC_LABEL[food.src], food.brand].filter(Boolean).join(' · ')),
          h('div', { class: 'muted small mt' }, `Por 100 g: ${kcalTxt(food.n.kcal)} · C ${fmtNum(food.n.c, 1)} · P ${fmtNum(food.n.p, 1)} · G ${fmtNum(food.n.f, 1)}`)));

        root.append(h('div', { class: 'card' },
          h('label', { class: 'field' }, h('span', null, 'Quantidade (g)'), gIn),
          h('div', { class: 'chips' }, food.recipeWeight
            ? [[0.5, '½ receita'], [1, '1 receita'], [1.5, '1,5 receita'], [2, '2 receitas']].map(([q, l]) => chip(Math.round(food.recipeWeight * q), l))
            : [food.portion ? chip(food.portion, `1 porção (${fmtNum(food.portion)} g)`) : null, [50, 100, 150, 200, 300].map((x) => chip(x))]),
          prev));
        upd();

        const ok = async () => {
          if (!g || g <= 0) { toast('Informe a quantidade'); return; }
          if (edit) {
            edit.item.grams = g;
            await saveDay(edit.day);
            state.stack.pop(); render();
          } else if (target?.pick) {
            target.pick(food, g);
            popUntil((v) => v.isRecipeEditor);
          } else {
            const day = getDay(target.date);
            day.meals[target.meal].push(foodToItem(food, g));
            await saveDay(day);
            toast(`${food.name.split(',')[0]} adicionado`);
            popUntil(() => false);
          }
        };
        root.append(h('button', { class: 'btn primary block', onclick: ok }, edit ? 'Salvar' : 'Adicionar'));
        if (edit) {
          root.append(h('button', {
            class: 'btn ghost danger block', onclick: async () => {
              const arr = edit.day.meals[edit.meal];
              arr.splice(arr.indexOf(edit.item), 1);
              await saveDay(edit.day);
              state.stack.pop(); render();
            },
          }, 'Remover da refeição'));
        }
        setTimeout(() => { gIn.focus(); gIn.select(); }, 50);
      },
    };
  }

  /** Volta na pilha até a view que satisfaz `pred` (ou até a raiz). */
  function popUntil(pred) {
    while (state.stack.length && !pred(state.stack[state.stack.length - 1])) state.stack.pop();
    render();
  }

  // ======================================================================
  // Editor de alimento (manual / revisão de scan / código de barras)
  // ======================================================================
  /** opts: { target?, initial?, edit?: food, paste?: bool } */
  function foodEditor({ target, initial, edit, paste }) {
    const f = edit ? clone(edit) : { id: uid(), name: '', brand: '', ean: '', portion: null, n: { kcal: null, c: null, p: null, f: null }, origin: 'manual', ...(initial ? clone(initial) : {}) };
    // valores exibidos conforme a base escolhida
    let basis = initial?.basis || '100';
    const vals = { ...f.n };
    let save = true;
    let ocrBox, pasteBox, fields = {};

    const view = {
      title: edit ? 'Editar alimento' : 'Novo alimento',
      runOCR: null,
      render(root) {
        ocrBox = h('div');
        pasteBox = h('div', { class: 'card', hidden: !paste },
          h('label', { class: 'field' }, h('span', null, 'Cole o texto da tabela'),
            h('textarea', { class: 'input', rows: 7, placeholder: 'No iPhone: abra a Câmera ou uma foto da tabela, toque no ícone de Texto ao Vivo, selecione tudo e copie.' })),
          h('button', { class: 'btn primary block', style: 'margin-top:0', onclick: () => applyText(pasteBox.querySelector('textarea').value) }, 'Interpretar'));

        root.append(h('div', { class: 'row', style: 'margin-bottom:12px' },
          h('button', { class: 'btn small grow', onclick: () => pickFile('image/*', (file) => view.runOCR(file)) }, 'Ler foto da tabela'),
          h('button', { class: 'btn small grow', onclick: () => { pasteBox.hidden = !pasteBox.hidden; } }, 'Colar texto')));
        root.append(ocrBox, pasteBox);

        const field = (key, label, attrs = {}) => {
          const el = h('input', { class: 'input', inputmode: 'decimal', value: vals[key] != null ? fmtNum(vals[key], 2) : '', placeholder: '0', ...attrs, oninput: (e) => { vals[key] = parseNum(e.target.value); hint(); } });
          fields[key] = el;
          return h('label', { class: 'field' }, h('span', null, label), el);
        };
        const kcalHint = h('div', { class: 'muted small' });
        const hint = () => {
          const est = (vals.c || 0) * 4 + (vals.p || 0) * 4 + (vals.f || 0) * 9;
          kcalHint.textContent = est ? `Pelos macros: ≈ ${fmtNum(est, 0)} kcal` : '';
        };
        const portionIn = h('input', { class: 'input', inputmode: 'decimal', value: f.portion != null ? fmtNum(f.portion) : '', placeholder: 'ex.: 30', oninput: (e) => { f.portion = parseNum(e.target.value); } });
        const seg = h('div', { class: 'seg' });
        const drawSeg = () => seg.replaceChildren(
          h('button', { class: basis === '100' ? 'on' : '', onclick: () => { basis = '100'; drawSeg(); } }, 'por 100 g'),
          h('button', { class: basis === 'portion' ? 'on' : '', onclick: () => { basis = 'portion'; drawSeg(); } }, 'por porção'));
        drawSeg();
        view.refreshFields = () => {
          for (const k of ['kcal', 'c', 'p', 'f']) fields[k].value = vals[k] != null ? fmtNum(vals[k], 2) : '';
          portionIn.value = f.portion != null ? fmtNum(f.portion) : '';
          drawSeg(); hint();
        };

        root.append(h('div', { class: 'card' },
          h('label', { class: 'field' }, h('span', null, 'Nome'), h('input', { class: 'input', value: f.name, placeholder: 'Ex.: Whey protein baunilha', oninput: (e) => { f.name = e.target.value; } })),
          h('div', { class: 'row' },
            h('label', { class: 'field grow' }, h('span', null, 'Marca (opcional)'), h('input', { class: 'input', value: f.brand || '', oninput: (e) => { f.brand = e.target.value; } })),
            h('label', { class: 'field', style: 'width:110px' }, h('span', null, 'Porção (g)'), portionIn)),
          f.ean ? h('div', { class: 'muted small', style: 'margin:-4px 2px 10px' }, `Código de barras: ${f.ean}`) : null));

        root.append(h('div', { class: 'card' },
          h('div', { class: 'muted small', style: 'margin-bottom:6px' }, 'Valores da tabela'), seg,
          h('div', { class: 'grid2' }, field('kcal', 'Calorias (kcal)'), field('c', 'Carboidratos (g)'), field('p', 'Proteínas (g)'), field('f', 'Gorduras totais (g)')),
          kcalHint));
        hint();

        if (target) {
          root.append(h('label', { class: 'check-line' },
            h('input', { type: 'checkbox', checked: save, onchange: (e) => { save = e.target.checked; } }),
            'Salvar em "Meus alimentos"'));
        }
        root.append(h('button', { class: 'btn primary block', onclick: submit }, target ? 'Continuar' : 'Salvar'));
        if (edit) {
          root.append(h('button', {
            class: 'btn ghost danger block', onclick: async () => {
              if (!confirm(`Excluir "${f.name}"? Registros antigos no diário continuam.`)) return;
              await db.del('foods', f.id);
              D.foods = D.foods.filter((x) => x.id !== f.id);
              state.stack.pop(); render();
            },
          }, 'Excluir alimento'));
        }
        if (view._pendingFile) { const fl = view._pendingFile; view._pendingFile = null; view.runOCR(fl); }
      },
    };

    function applyParsed(res) {
      if (!res.found) { toast('Não encontrei valores. Confira ou digite manualmente.'); return false; }
      basis = res.basis;
      if (res.portion) f.portion = res.portion;
      Object.assign(vals, res.values);
      view.refreshFields?.();
      toast(`${res.found} valores lidos — confira antes de salvar`);
      return true;
    }
    function applyText(text) {
      if (applyParsed(parseLabel(text))) pasteBox.hidden = true;
    }

    view.runOCR = async (file) => {
      if (!ocrBox) { view._pendingFile = file; return; }
      const status = h('div', { class: 'muted small' }, 'Preparando imagem…');
      const prog = h('div', { class: 'bar kcal' }, h('i', { style: 'width:0%' }));
      const thumb = h('img', { class: 'ocr-thumb', src: URL.createObjectURL(file), alt: '' });
      ocrBox.replaceChildren(h('div', { class: 'card' }, thumb, status, prog));
      try {
        const text = await ocrImage(file, (m) => {
          if (m.status === 'recognizing text') { status.textContent = `Lendo texto… ${Math.round(m.progress * 100)}%`; prog.firstChild.style.width = `${m.progress * 100}%`; }
          else if (m.status) status.textContent = m.status.includes('load') ? 'Carregando OCR (1ª vez pode demorar)…' : 'Preparando…';
        });
        const res = parseLabel(text);
        const ta = h('textarea', { class: 'input', rows: 6 }, text);
        ocrBox.replaceChildren(h('div', { class: 'card' },
          thumb,
          h('div', { class: 'muted small' }, res.found ? `Texto lido. ${res.found} de 4 valores encontrados.` : 'Texto lido, mas não encontrei os valores. Corrija o texto abaixo e toque em Interpretar, ou digite os valores.'),
          h('details', { open: !res.found }, h('summary', { class: 'small' }, 'Ver texto reconhecido'), ta,
            h('button', { class: 'btn small block', onclick: () => applyParsed(parseLabel(ta.value)) }, 'Interpretar novamente'))));
        applyParsed(res);
      } catch (e) {
        console.error(e);
        ocrBox.replaceChildren(h('div', { class: 'card warn small' }, `Não foi possível ler a foto: ${e.message || e}. Sem internet na 1ª vez o OCR não carrega — tente "Colar texto".`));
      }
    };

    async function submit() {
      f.name = f.name.trim();
      if (!f.name) { toast('Dê um nome ao alimento'); return; }
      if (vals.kcal == null && vals.c == null && vals.p == null && vals.f == null) { toast('Preencha os valores da tabela'); return; }
      if (basis === 'portion' && !f.portion) { toast('Informe a porção em gramas'); return; }
      const k = basis === 'portion' ? 100 / f.portion : 1;
      const n = {
        kcal: r1(((vals.kcal ?? ((vals.c || 0) * 4 + (vals.p || 0) * 4 + (vals.f || 0) * 9))) * k),
        c: r1((vals.c || 0) * k), p: r1((vals.p || 0) * k), f: r1((vals.f || 0) * k),
      };
      const food = { id: f.id, name: f.name, brand: (f.brand || '').trim(), ean: f.ean || '', portion: f.portion || null, n, origin: f.origin || 'manual', updatedAt: Date.now() };
      if (!target || save) {
        await db.put('foods', food);
        const i = D.foods.findIndex((x) => x.id === food.id);
        if (i >= 0) D.foods[i] = food; else D.foods.push(food);
      }
      if (target) {
        state.stack.pop();
        go(qtyView({ food: { ...food, src: 'custom' }, target, grams: food.portion || 100 }));
      } else {
        toast('Alimento salvo');
        state.stack.pop(); render();
      }
    }

    return view;
  }

  async function ocrImage(file, logger) {
    await loadScript('./js/vendor/tesseract.min.js');
    const canvas = await preprocess(file);
    const worker = await window.Tesseract.createWorker('por', 1, {
      workerPath: new URL('./js/vendor/worker.min.js', location.href).href,
      corePath: new URL('./js/vendor/tesseract-core/', location.href).href,
      langPath: new URL('./js/vendor/lang', location.href).href.replace(/\/$/, ''),
      workerBlobURL: false,
      logger,
    });
    try {
      await worker.setParameters({ preserve_interword_spaces: '1' });
      const { data } = await worker.recognize(canvas);
      return data.text || '';
    } finally {
      worker.terminate();
    }
  }

  /** Redimensiona, converte para tons de cinza e aumenta o contraste (melhora o OCR). */
  async function preprocess(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Imagem inválida')); i.src = url; });
      const maxSide = 2200, minSide = 1400;
      let scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      if (Math.max(img.width, img.height) * scale < minSide) scale = minSide / Math.max(img.width, img.height);
      const w = Math.round(img.width * scale), hgt = Math.round(img.height * scale);
      const c = document.createElement('canvas');
      c.width = w; c.height = hgt;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, w, hgt);
      const d = g.getImageData(0, 0, w, hgt), px = d.data;
      let lo = 255, hi = 0;
      for (let i = 0; i < px.length; i += 4) {
        const y = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        px[i] = y;
        if (y < lo) lo = y; if (y > hi) hi = y;
      }
      const span = Math.max(1, hi - lo);
      for (let i = 0; i < px.length; i += 4) {
        const y = ((px[i] - lo) / span) * 255;
        px[i] = px[i + 1] = px[i + 2] = y;
      }
      g.putImageData(d, 0, 0);
      return c;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // ======================================================================
  // Código de barras
  // ======================================================================
  function barcodeView(target) {
    return {
      title: 'Código de barras',
      async render(root) {
        const video = h('video', { class: 'scan-video', playsinline: true, muted: true, autoplay: true });
        const status = h('div', { class: 'muted small center' }, 'Abrindo câmera…');
        const eanIn = h('input', { class: 'input', inputmode: 'numeric', pattern: '[0-9]*', placeholder: 'Ou digite o código (EAN)' });
        let reader = null, done = false;

        const found = (code) => {
          if (done) return;
          done = true;
          try { reader?.reset(); } catch { /* */ }
          lookup(code.trim(), target);
        };

        root.append(
          h('div', { class: 'scan-box' }, video, h('div', { class: 'scan-line' })),
          status,
          h('div', { class: 'row mt' }, eanIn, h('button', { class: 'btn', onclick: () => { if (eanIn.value.trim().length >= 8) found(eanIn.value); else toast('Código inválido'); } }, 'Buscar')),
          h('button', {
            class: 'btn block', onclick: () => pickFile('image/*', async (file) => {
              status.textContent = 'Lendo foto…';
              try {
                await loadScript('./js/vendor/zxing.min.js');
                const r = makeReader();
                const url = URL.createObjectURL(file);
                const res = await r.decodeFromImageUrl(url);
                URL.revokeObjectURL(url);
                found(res.getText());
              } catch { status.textContent = 'Não achei um código de barras na foto. Tente mais perto e com boa luz.'; }
            }),
          }, 'Usar foto do código'));

        try {
          await loadScript('./js/vendor/zxing.min.js');
          if (!navigator.mediaDevices?.getUserMedia) throw new Error('sem câmera');
          reader = makeReader();
          await reader.decodeFromConstraints({ video: { facingMode: 'environment', width: { ideal: 1280 } } }, video, (res) => { if (res) found(res.getText()); });
          status.textContent = 'Aponte para o código de barras';
        } catch (e) {
          status.textContent = location.protocol !== 'https:' && location.hostname !== 'localhost'
            ? 'Câmera ao vivo só funciona em HTTPS. Use "Usar foto do código" ou digite.'
            : 'Câmera indisponível. Use "Usar foto do código" ou digite.';
        }
        return () => { done = true; try { reader?.reset(); } catch { /* */ } };
      },
    };
  }

  function makeReader() {
    const Z = window.ZXing;
    const hints = new Map();
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E]);
    hints.set(Z.DecodeHintType.TRY_HARDER, true);
    return new Z.BrowserMultiFormatReader(hints, 250);
  }

  async function lookup(ean, target) {
    // 1) já cadastrado
    const mine = D.foods.find((f) => f.ean === ean);
    if (mine) {
      state.stack.pop();
      go(qtyView({ food: { ...mine, src: 'custom' }, target }));
      return;
    }
    // 2) Open Food Facts
    toast('Buscando produto…');
    let initial = { ean, origin: 'off' };
    try {
      if (!navigator.onLine) throw new Error('offline');
      const res = await fetch(OFF_URL(ean));
      const data = await res.json();
      const p = data?.product;
      const nu = p?.nutriments || {};
      const kcal = nu['energy-kcal_100g'] ?? (nu['energy_100g'] != null ? nu['energy_100g'] / 4.184 : null);
      if (data?.status === 1 && p) {
        initial = {
          ean, origin: 'off',
          name: p.product_name_pt || p.product_name || '',
          brand: (p.brands || '').split(',')[0].trim(),
          portion: parseNum(p.serving_quantity) || null,
          n: { kcal: kcal != null ? r1(kcal) : null, c: nu.carbohydrates_100g ?? null, p: nu.proteins_100g ?? null, f: nu.fat_100g ?? null },
          basis: '100',
        };
        const complete = ['kcal', 'c', 'p', 'f'].every((k) => initial.n[k] != null);
        toast(complete ? 'Produto encontrado — confira os valores' : 'Produto encontrado, mas sem tabela completa. Leia a foto da tabela.');
      } else {
        toast('Produto não encontrado. Use a foto da tabela ou digite.');
      }
    } catch {
      toast('Sem conexão. Use a foto da tabela ou digite.');
    }
    state.stack.pop();
    go(foodEditor({ target, initial }));
  }

  // ======================================================================
  // Meus alimentos
  // ======================================================================
  function myFoodsView() {
    return {
      title: 'Meus alimentos',
      actions: [{ label: '+ Novo', primary: true, onclick: () => go(foodEditor({})) }],
      render(root) {
        if (!D.foods.length) { root.append(h('div', { class: 'empty' }, h('b', null, 'Nenhum alimento'), 'Alimentos cadastrados manualmente ou por scan aparecem aqui.')); return; }
        const list = [...D.foods].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
        root.append(h('div', { class: 'list' }, list.map((f) => h('button', { class: 'list-item', onclick: () => go(foodEditor({ edit: f })) },
          h('div', { class: 'grow' }, h('div', { class: 'li-title' }, f.name, f.brand ? h('span', { class: 'muted' }, ` · ${f.brand}`) : null),
            h('div', { class: 'li-sub' }, `100 g: ${kcalTxt(f.n.kcal)} · ${macroLine(f.n)}${f.ean ? ' · EAN' : ''}`)),
          icon('chev')))));
      },
    };
  }

  // ======================================================================
  // Receitas
  // ======================================================================
  function recipesView() {
    return {
      title: 'Receitas',
      actions: [{ label: '+ Nova', primary: true, onclick: () => go(recipeEditor(null)) }],
      render(root) {
        if (!D.recipes.length) {
          root.append(h('div', { class: 'empty' }, h('b', null, 'Nenhuma receita'), 'Junte vários alimentos em um prato (ex.: strogonoff) e registre só os gramas que comeu.'));
          return;
        }
        const list = [...D.recipes].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
        root.append(h('div', { class: 'list' }, list.map((r) => {
          const t = recipeTotals(r);
          return h('button', { class: 'list-item', onclick: () => go(recipeEditor(r)) },
            h('div', { class: 'grow' }, h('div', { class: 'li-title' }, r.name),
              h('div', { class: 'li-sub' }, `${r.items.length} ingredientes · ${fmtNum(t.weight, 0)} g · 100 g: ${kcalTxt(t.per100.kcal)}`)),
            icon('chev'));
        })));
      },
    };
  }

  function recipeEditor(rec) {
    const r = rec ? clone(rec) : { id: uid(), name: '', items: [], finalWeight: null };
    let dirty = false;
    const view = {
      isRecipeEditor: true,
      title: rec ? 'Editar receita' : 'Nova receita',
      actions: [{ label: 'Salvar', primary: true, onclick: () => save() }],
      beforeLeave() { return !dirty || confirm('Descartar as alterações da receita?'); },
      render(root) {
        root.append(h('div', { class: 'card' },
          h('label', { class: 'field', style: 'margin:0' }, h('span', null, 'Nome da receita'),
            h('input', { class: 'input', value: r.name, placeholder: 'Ex.: Strogonoff de frango', oninput: (e) => { r.name = e.target.value; dirty = true; } }))));

        root.append(h('div', { class: 'section' }, 'Ingredientes'));
        const list = h('div', { class: 'card' });
        const totals = h('div', { class: 'card' });
        const fwIn = h('input', { class: 'input', inputmode: 'decimal', value: r.finalWeight ? fmtNum(r.finalWeight) : '', oninput: (e) => { r.finalWeight = parseNum(e.target.value); dirty = true; drawTotals(); } });

        const drawTotals = () => {
          const t = recipeTotals(r);
          fwIn.placeholder = fmtNum(t.raw, 0);
          totals.replaceChildren(
            h('label', { class: 'field' }, h('span', null, 'Peso final do prato pronto (g)'), fwIn,
              h('div', { class: 'muted small', style: 'margin-top:4px' }, 'Opcional. Pese a panela pronta (descontando a tara) para considerar o que evaporou no cozimento. Em branco, usa a soma dos ingredientes.')),
            h('div', { class: 'detail-set' }, h('span', { class: 'muted' }, 'Total do prato'), h('b', null, `${kcalTxt(t.tot.kcal)} · ${fmtNum(t.weight, 0)} g`)),
            h('div', { class: 'detail-set' }, h('span', { class: 'muted' }, 'Por 100 g'), h('b', null, `${kcalTxt(t.per100.kcal)} · ${macroLine(t.per100)}`)));
        };
        const drawList = () => {
          if (!r.items.length) { list.replaceChildren(h('div', { class: 'muted small center' }, 'Nenhum ingrediente ainda.')); return; }
          list.replaceChildren(...r.items.map((it, i) => {
            const k = calc(it.n, it.grams || 0);
            const sub = h('div', { class: 'li-sub' }, `${kcalTxt(k.kcal)} · ${macroLine(k)}`);
            return h('div', { class: 'ing-row' },
              h('div', { class: 'grow' }, h('div', { class: 'li-title' }, it.name), sub),
              h('input', {
                class: 'num', style: 'width:76px', inputmode: 'decimal', value: fmtNum(it.grams), 'aria-label': 'Gramas',
                oninput: (e) => { it.grams = parseNum(e.target.value) || 0; dirty = true; const kk = calc(it.n, it.grams); sub.textContent = `${kcalTxt(kk.kcal)} · ${macroLine(kk)}`; drawTotals(); },
              }),
              h('span', { class: 'muted small' }, 'g'),
              h('button', { class: 'icon-btn danger', 'aria-label': 'Remover', onclick: () => { r.items.splice(i, 1); dirty = true; drawList(); drawTotals(); } }, icon('x')));
          }));
        };
        drawList(); drawTotals();

        root.append(list,
          h('button', {
            class: 'btn block', style: 'margin:0 0 12px', onclick: () => go(addFoodView({
              pick: (food, grams) => { r.items.push(foodToItem(food, grams)); dirty = true; },
            })),
          }, '+ Ingrediente'),
          totals);

        if (rec) {
          root.append(h('button', {
            class: 'btn ghost danger block', onclick: async () => {
              if (!confirm(`Excluir a receita "${r.name}"? Registros antigos no diário continuam.`)) return;
              await db.del('recipes', r.id);
              D.recipes = D.recipes.filter((x) => x.id !== r.id);
              dirty = false; state.stack.pop(); render();
            },
          }, 'Excluir receita'));
        }
      },
    };

    async function save() {
      r.name = r.name.trim();
      if (!r.name) { toast('Dê um nome à receita'); return; }
      if (!r.items.length) { toast('Adicione ingredientes'); return; }
      r.items = r.items.filter((it) => it.grams > 0);
      r.updatedAt = Date.now();
      await db.put('recipes', r);
      const i = D.recipes.findIndex((x) => x.id === r.id);
      if (i >= 0) D.recipes[i] = r; else D.recipes.push(r);
      dirty = false;
      toast('Receita salva');
      state.stack.pop(); render();
    }
    return view;
  }

  // ======================================================================
  // Meta
  // ======================================================================
  function goalView() {
    const g = { ...D.goal };
    return {
      title: 'Meta diária',
      actions: [{ label: 'Salvar', primary: true, onclick: () => save() }],
      render(root) {
        const prev = h('div');
        const upd = () => {
          const sum = (g.pc || 0) + (g.pp || 0) + (g.pf || 0);
          const gg = goalGrams(g);
          prev.replaceChildren(
            h('div', { class: 'small ' + (sum === 100 ? 'muted' : 'warn'), style: 'margin-bottom:8px' }, `Soma: ${sum}%` + (sum === 100 ? '' : ' (precisa ser 100%)')),
            h('div', { class: 'macros' },
              h('div', { class: 'macro' }, h('div', { class: 'macro-lbl' }, 'Carbo'), h('div', { class: 'macro-val' }, `${fmtNum(gg.c, 0)} g`)),
              h('div', { class: 'macro' }, h('div', { class: 'macro-lbl' }, 'Proteína'), h('div', { class: 'macro-val' }, `${fmtNum(gg.p, 0)} g`)),
              h('div', { class: 'macro' }, h('div', { class: 'macro-lbl' }, 'Gordura'), h('div', { class: 'macro-val' }, `${fmtNum(gg.f, 0)} g`))));
        };
        const pctIn = (key, label) => h('label', { class: 'field' }, h('span', null, label),
          h('input', { class: 'input', inputmode: 'numeric', pattern: '[0-9]*', value: String(g[key]), style: 'text-align:center', oninput: (e) => { g[key] = parseNum(e.target.value) || 0; upd(); } }));

        root.append(h('div', { class: 'card' },
          h('label', { class: 'field' }, h('span', null, 'Meta de calorias (kcal/dia)'),
            h('input', { class: 'input qty-input', inputmode: 'numeric', pattern: '[0-9]*', value: String(g.kcal), oninput: (e) => { g.kcal = parseNum(e.target.value) || 0; upd(); } })),
          h('div', { class: 'grid3' }, pctIn('pc', 'Carbo %'), pctIn('pp', 'Proteína %'), pctIn('pf', 'Gordura %')),
          prev,
          h('p', { class: 'muted small' }, 'Conversão: carboidrato e proteína 4 kcal/g, gordura 9 kcal/g.')));
        upd();
        root.append(h('button', { class: 'btn ghost block', onclick: () => { Object.assign(g, { pc: 40, pp: 30, pf: 30 }); rerender(); } }, 'Voltar para 40/30/30'));
      },
    };
    async function save() {
      if (!g.kcal || g.kcal < 500) { toast('Meta de kcal inválida'); return; }
      if ((g.pc + g.pp + g.pf) !== 100) { toast('Os percentuais precisam somar 100%'); return; }
      D.goal = g;
      await db.put('kv', g, 'dietGoal');
      toast('Meta salva');
      state.stack.pop(); render();
    }
  }

  // ======================================================================
  // Backup
  // ======================================================================
  const backupData = () => ({ foods: D.foods, recipes: D.recipes, days: [...D.days.values()], dietGoal: D.goal });
  async function restore(data) {
    if (data.dietGoal) await db.put('kv', data.dietGoal, 'dietGoal');
  }

  return { load, dietaView, backupData, restore };
}
