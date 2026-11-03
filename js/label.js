// Interpretador de tabela nutricional brasileira (texto de OCR ou colado do Texto ao Vivo)
// Suporta o formato novo (RDC 429/2020: colunas "100 g" | "porção" | %VD) e o antigo (porção | %VD).

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const num = (s) => {
  const n = Number(String(s).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/** Corrige trocas comuns do OCR (O→0, l/I→1 colados em números) */
function fixOCR(line) {
  return line
    .replace(/(\d)[oO]/g, '$10')
    .replace(/[oO](?=[.,]\d)/g, '0')
    .replace(/(\d)[,.]\s+(\d)/g, '$1,$2')
    .replace(/(\d)[lI|](?=\d|\s|$)/g, '$11');
}

/** Números de uma string, ignorando %VD e kJ. */
function valuesOf(rest) {
  const s = rest
    .replace(/\(([^)]*)\)/g, ' ')                                // (g), (kcal), (mg)
    .replace(/\d+(?:[.,]\d+)?\s*kj/gi, ' ')                      // 479 kJ
    .replace(/\d+(?:[.,]\d+)?\s*%/g, ' ');                       // 6%
  const kcalHits = [...s.matchAll(/(\d+(?:[.,]\d+)?)\s*kcal/gi)].map((m) => num(m[1]));
  if (kcalHits.length) return kcalHits;
  return [...s.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => num(m[0])).filter((v) => v != null);
}

function kjOnly(rest) {
  const m = rest.match(/(\d+(?:[.,]\d+)?)\s*kj/i);
  return m ? num(m[1]) / 4.184 : null;
}

const NUTRIENTS = [
  { key: 'kcal', test: (l) => /valor\s*energ|^energia|calorias/.test(l) },
  { key: 'c', test: (l) => /carboidrato/.test(l) && !/acucar/.test(l) },
  { key: 'p', test: (l) => /proteina/.test(l) },
  { key: 'f', test: (l) => /(gorduras?\s*tota|lipid|^gorduras?\b(?!.*(satur|trans|mono|poli)))/.test(l) },
];

/**
 * @returns {{ basis: '100'|'portion', portion: number|null, unit: 'g'|'ml', values: {kcal,c,p,f}, found: number }}
 * values estão na base indicada em `basis`.
 */
export function parseLabel(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => fixOCR(l.trim())).filter(Boolean);
  const all = norm(lines.join('\n'));

  // Porção
  let portion = null, unit = 'g';
  const pm = all.match(/por[cç][aã]o\s*(?:de|:)?\s*:?\s*(\d+(?:[.,]\d+)?)\s*(g|ml)\b/)
    || all.match(/(\d+(?:[.,]\d+)?)\s*(g|ml)\s*\(\s*\d/); // "30 g (1 xícara)"
  if (pm) { portion = num(pm[1]); unit = pm[2]; }

  // Coluna "100 g"? Procura "100 g" / "100g" / "100 ml" fora da frase de porção.
  const header = all.replace(/por[cç][aã]o\s*(?:de|:)?\s*:?\s*100\s*(g|ml)/g, '');
  const has100 = /\b100\s*(g|ml)\b/.test(header) || (portion === 100);

  const per100 = {}, perPortion = {};
  let found = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const l = norm(raw);
    const nut = NUTRIENTS.find((n) => n.test(l));
    if (!nut || per100[nut.key] != null || perPortion[nut.key] != null) continue;
    // remove o rótulo: tudo até o primeiro dígito
    // ignora dígitos dentro de parênteses do rótulo, ex.: "Proteínas (9)" (OCR de "(g)")
    const idx = raw.replace(/\([^)]*\)/g, (m) => ' '.repeat(m.length)).search(/\d/);
    let rest;
    if (idx >= 0) rest = raw.slice(idx);
    else {
      // Texto ao Vivo às vezes coloca os números nas linhas seguintes
      const nums = [];
      for (let j = i + 1; j < lines.length && j <= i + 3 && /^[\d.,\s%a-zA-Z]{1,14}$/.test(lines[j]) && /\d/.test(lines[j]); j++) nums.push(lines[j]);
      if (!nums.length) continue;
      rest = nums.join(' ');
    }
    let vals = valuesOf(rest);
    if (!vals.length && nut.key === 'kcal') { const k = kjOnly(rest); if (k != null) vals = [Math.round(k)]; }
    if (!vals.length) continue;
    found++;
    if (has100 && portion !== 100 && vals.length >= 2) { per100[nut.key] = vals[0]; perPortion[nut.key] = vals[1]; }
    else if (has100) per100[nut.key] = vals[0];
    else perPortion[nut.key] = vals[0];
  }

  const useBase100 = Object.keys(per100).length >= Object.keys(perPortion).length && Object.keys(per100).length > 0;
  const src = useBase100 ? per100 : perPortion;
  const values = { kcal: src.kcal ?? null, c: src.c ?? null, p: src.p ?? null, f: src.f ?? null };
  if (values.kcal == null && (values.c != null || values.p != null || values.f != null)) {
    values.kcal = Math.round((values.c || 0) * 4 + (values.p || 0) * 4 + (values.f || 0) * 9);
    values.kcalEstimated = true;
  }
  return { basis: useBase100 ? '100' : 'portion', portion, unit, values, found };
}
