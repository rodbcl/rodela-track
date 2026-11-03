# Rodela Track

PWA pessoal para iPhone: registro de treinos (e, na próxima versão, dieta). Funciona offline e guarda os dados só no aparelho (IndexedDB).

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
