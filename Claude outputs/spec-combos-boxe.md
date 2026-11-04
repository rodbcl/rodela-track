# Rodela Track — Gerador de combos de boxe (especificação para revisão)

Funciona como um modo opcional dentro do treino de boxe que já existe. Serve para manopla ou saco.

## 1. Nomenclatura

| Código | Movimento | Tipo | Mão / lado |
|---|---|---|---|
| 1 | Jab | Golpe | Frente |
| 2 | Direto | Golpe | Trás |
| 3 | Cruzado de frente | Golpe | Frente |
| 4 | Cruzado de trás | Golpe | Trás |
| 5 | Upper de frente | Golpe | Frente |
| 6 | Upper de trás | Golpe | Trás |
| 1B … 6B | Mesmo golpe na linha do corpo | Golpe | igual ao golpe |
| E | Esquiva para a esquerda | Defesa | — |
| D | Esquiva para a direita | Defesa | — |
| P | Pêndulo | Defesa | — |
| BF | Bloqueio com a mão da frente | Defesa | Frente |
| BT | Bloqueio com a mão de trás | Defesa | Trás |
| PF | Passo à frente | Movimentação | — |
| PT | Passo para trás | Movimentação | — |
| PVE | Pivô para a esquerda | Movimentação | — |
| PVD | Pivô para a direita | Movimentação | — |

> Base: **guarda destra (ortodoxa)**, com mão da frente = esquerda. Se você luta canhoto, as regras de esquiva e pivô se espelham.

## 2. Configuração (no treino de boxe)

| Item | Opções |
|---|---|
| Modo combos | ligado / desligado |
| Etapas por round | 1 a 6 partes iguais (ex.: round de 3:00 em 3 partes = 1 min cada) |
| Incremento por etapa | +1, +2 ou "1 ou 2" (sorteado) |
| Tamanho inicial | 2 a 4 movimentos |
| Tamanho máximo | 4 a 12 movimentos |
| Entre rounds | **continuar** crescendo o mesmo combo, ou **novo combo** a cada round |
| Ao bater o máximo | recomeçar com um combo novo, ou manter o tamanho e trocar só o final |
| Movimentos permitidos | marcar o que entra: golpes no corpo, esquivas, pêndulo, bloqueios, passos, pivôs |
| Dificuldade | básico (só golpes e poucas defesas) / intermediário / avançado |
| Biblioteca | usar só o gerador, gerador + favoritos, ou só favoritos |

Não há voz. O combo aparece em letras grandes na tela do timer, com um bipe curto quando muda.

## 3. Regras do gerador (REVISAR)

Funcionamento: o app escolhe cada próximo movimento olhando os anteriores, com **pesos** (probabilidades). Também existem **proibições**, que nunca acontecem.

### Começo do combo
- R1. Começa com **1** (muito comum), **2** ou **1-1** (jab duplo). Raramente com defesa.
- R2. Nunca começa com bloqueio ou passo para trás.

### Alternância de mãos
- R3. Depois de golpe da mão da frente, prefere golpe da mão de trás, e vice-versa.
- R4. A mesma mão no máximo **2× seguidas** (permite 1-1, 3-3B e 1-3).
- R5. Golpe repetido idêntico só no jab (1-1) e no cruzado de frente alto/baixo (3-3B).

### Combinações naturais (peso maior)
- R6. 1 → 2 · 2 → 3 · 3 → 2 · 2 → 3B · 3B → 3 · 5 → 2 · 6 → 3 · 1 → 6 · 2 → 5.
- R7. Golpe no corpo costuma vir antes de um golpe alto (ex.: 3B → 3, 2B → 3).

### Defesas
- R8. Depois de golpe de trás (2, 4, 6) → **E** ou **P** fazem sentido (o oponente "devolve").
- R9. Depois de 3 → **D** ou **P**.
- R10. Esquiva prepara golpe do lado oposto: **E → 2 ou 4**, **D → 3 ou 5**.
- R11. Pêndulo é seguido de golpe (nunca de outra defesa).
- R12. Bloqueio vem no meio ou no fim, seguido de contra-ataque: BF → 2 ou 4, BT → 3 ou 1.
- R13. No máximo **2 defesas seguidas**. O combo nunca termina com 2 defesas.

### Movimentação
- R14. **PF** vem antes de golpe (geralmente 1 ou 2).
- R15. **PT** e pivôs aparecem no fim ou depois de uma sequência de golpes.
- R16. **PVE** depois de 3 ou 1; **PVD** depois de 2 ou 4.
- R17. No máximo 1 passo ou pivô por bloco de 4 movimentos.

### Fim do combo
- R18. Prefere terminar com golpe de trás, defesa ou pivô (sair da linha). Evita terminar com jab isolado.

### Incremento ("continuar crescendo")
- R19. Mantém o combo atual inteiro e **acrescenta no fim** 1 a 2 movimentos, seguindo as regras acima.
- R20. Se o novo final ficar estranho (ex.: termina com 2 defesas), o app sorteia de novo.

## 4. Exemplo de round (3:00, 3 etapas, incremento 1 ou 2, máx. 8)

| Tempo | Combo |
|---|---|
| 0:00–1:00 | 1 · 2 · 3 |
| 1:00–2:00 | 1 · 2 · 3 · 3B · 2 |
| 2:00–3:00 | 1 · 2 · 3 · 3B · 2 · P · 2 |
| Round 2 (continuar) | 1 · 2 · 3 · 3B · 2 · P · 2 · PVE |
| Round 3 (bateu o máx.) | novo: 1 · 1 · 2 |

## 5. Tela do timer (com combos)

- O relógio e as cores continuam iguais: verde no round, amarelo nos últimos segundos, vermelho no descanso.
- Abaixo do relógio, o **combo atual** aparece em blocos grandes; as defesas e movimentações ficam com outra cor.
- No descanso, a tela mostra o **próximo combo** (prévia).
- Botões: ⟳ **trocar combo** (gera outro na hora) e ★ **salvar nos favoritos**.
- O histórico guarda os combos feitos em cada round.

## 6. Biblioteca de favoritos

- Os favoritos podem ser salvos pelo timer (★) ou digitados ("1 2 3B 3 P 2").
- O app confere se os códigos são válidos.
- Com o modo "gerador + favoritos", o round pode **começar** de um favorito e crescer com o gerador.

## 7. Pendências para você revisar

- [ ] As regras R1–R20 batem com o que se faz nas suas aulas? O que tirar, mudar ou acrescentar?
- [ ] Guarda destra (ortodoxa)?
- [ ] Algum combo clássico da sua academia para já vir na biblioteca?
