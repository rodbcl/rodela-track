# Rodela Track

PWA pessoal para iPhone: registro de treinos e dieta. Funciona offline e guarda os dados só no aparelho (IndexedDB).

## Estrutura

```
index.html            página única
manifest.webmanifest  metadados do PWA (nome, ícones)
sw.js                 service worker (cache offline) — aumente VERSION a cada release
css/style.css         estilos (claro/escuro automático)
js/app.js             telas e lógica
js/db.js              IndexedDB
js/util.js            utilitários
js/chart.js           gráfico SVG
js/dieta.js           módulo Dieta
js/rest.js            timer de descanso (contagem, bipe, tela ligada)
js/label.js           interpretador de tabela nutricional (RDC 429 e formato antigo)
js/vendor/            ZXing (código de barras) e Tesseract.js + idioma português (OCR)
data/taco.json        Tabela TACO (Unicamp) — 597 alimentos
icons/                ícones do app
```

Não tem build: é HTML + JS puro (módulos ES).

## Rodar localmente

```bash
python3 -m http.server 8000
```

## Publicar

Veja [GUIA-GITHUB-PAGES.md](GUIA-GITHUB-PAGES.md).

## Versões

- **0.1.0**: base PWA + módulo Treino (modelos A/B/C, sessão com última carga, timer de descanso, histórico, calendário, gráficos de progresso, backup JSON, importação de CSV).
- **0.2.0**: módulo Dieta — base TACO, Meus alimentos, receitas (com peso final do prato), 4 refeições, clonar refeição/dia, repetir de ontem, meta de kcal com divisão 40/30/30 (editável), código de barras (Open Food Facts), foto da tabela (OCR offline) e colar texto (Texto ao Vivo).

- **0.3.0**: timer de descanso com contagem regressiva e aviso sonoro (entre séries / entre exercícios / por exercício, ajustável ±15 s), tela ligada durante o treino; receitas entram inteiras na refeição com um toque (½, 1, 1,5, 2 receitas ao editar).

## Testar no iPhone pela rede local

```bash
python3 -m http.server 8000 --bind 0.0.0.0
```

Abra `http://IP-DO-PC:8000` no Safari. Pelo IP (sem HTTPS) a **câmera ao vivo** do código de barras e o modo offline não funcionam — use "Usar foto do código". No GitHub Pages (HTTPS) tudo funciona.

## Créditos

- TACO — Tabela Brasileira de Composição de Alimentos, NEPA/Unicamp (dados via raulfdm/taco-api)
- ZXing (Apache-2.0), Tesseract.js (Apache-2.0), Open Food Facts (ODbL)
