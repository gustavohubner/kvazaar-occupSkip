# Site interativo de resultados

Abra **`index.html`** no navegador (duplo clique, ou `xdg-open index.html`).
Não precisa de servidor, internet nem instalação: `data.js` define
`window.RD_DATA` com o JSON minificado e os gráficos são SVG gerados em
JavaScript puro. A URL troca de hash (`#rd`, `#overview`, `#pareto`,
`#tables`, `#time`, `#about`), então dá para linkar direto para uma aba.

## Arquivos

| Arquivo | Conteúdo |
|---|---|
| `index.html` | estrutura das abas e dos filtros |
| `style.css` | layout (sidebar + conteúdo, responsivo), limites de largura, fontes e animações de entrada |
| `app.js` | agregações, gráficos SVG, tabelas, ordenação, CSV e animações de posição/números (0,5 s) |
| `pareto.js` | cálculo do BD-rate (PCHIP), do ganho de tempo com IC95% por bootstrap e da frente de Pareto; sem dependências |
| `data.js` | `all_results_final.json` minificado (gerado) |

## O que cada aba mostra

- **Curvas RD** — X = bitrate (Mb/s a 25 fps) ou bytes; Y = PSNR global,
  ocupado ou vazio. Uma curva por **configuração × método de preenchimento**
  ligando r1→r5. A cor identifica a configuração; o formato do ponto
  identifica o preenchimento (círculo, quadrado, triângulo, estrela, na ordem
  de `axes.fill_methods`). A agregação é por energia de erro (SSE total /
  pixels totais), não média de dB. Passe o mouse nos pontos para ver Δbits e
  ΔPSNR contra o base do mesmo preenchimento e taxa. Clique na legenda para
  esconder/mostrar uma configuração ou um preenchimento. As tabelas abaixo
  agregam todos os preenchimentos selecionados, como se fosse um só
  experimento.
- **Visão geral** — mapa de calor com as 10 configs × 8 grupos
  (slow/fast × RA/AI × geometry/attribute), escolhendo a métrica (bits,
  PSNR ocupado, PSNR global, PSNR vazio, tempo user/wall). Clique no cabeçalho de uma
  coluna para abrir a curva RD daquele grupo. O scatter plota Δbits ×
  ΔPSNR ocupado com pontos de tamanho fixo e cor por configuração; o
  Δtempo user aparece no rótulo ao lado de cada ponto.
- **Pareto (BD × tempo)** — escolhe uma configuração por célula, calculando
  tudo no navegador a partir de `data.js`. X = ganho de tempo contra o base
  (`T%`), Y = BD-rate sobre a PSNR da região selecionada no menu lateral
  (`Y global`, `Y ocupado` ou `Y vazio`; padrão: `Y ocupado`). O ΔPSNR
  descritivo e a ponderação por pixels usam a mesma região. Curvas RD não
  monotônicas ou com sobreposição de PSNR < 0,5 dB não recebem BD-rate —
  são marcadas como indisponíveis, sem extrapolação. O tempo usa a mediana das
  10 repetições e o IC95% vem de bootstrap; o BD-rate usa PCHIP nos 5 QPs e
  média geométrica das curvas (5 sequências × preenchimentos marcados). A
  frente de Pareto é o conjunto não dominado; entre as configs da frente com
  `T% > 0`, IC95% do tempo > 0 e BD-rate válido, adota a maior pontuação
  `E = T% − λ·BD%`, com λ ajustável na aba (padrão 5), mantendo o `base` se
  nenhuma for elegível. BD negativo (menos bits) aumenta E; BD positivo reduz.
  Os **preenchimentos marcados na sidebar são agregados** no gráfico, na
  decisão principal e na coluna `config (seleção)` da tabela das 20 células
  (4 de geometria + 16 de atributo); a coluna `por fill` conserva o vencedor
  individual de cada preenchimento. Clicar numa linha marca só aquele
  preenchimento no gráfico. A tabela de pontuação ordena as configs da frente
  por `E`; não há limite fixo de BD-rate.
  O ΔPSNR no mesmo QP aparece só como descrição — o BD-rate já é medido a
  qualidade constante.
- **Tabelas** — `Agregados` (uma linha por config, com opção de comparar
  `dNqp25` contra o `dN` correspondente) e `Células` (250 linhas agregadas:
  10 configs × 5 sequências × 5 taxas; uma linha por célula combinando todos
  os preenchimentos selecionados, ordenável, paginada, com busca e
  exportação CSV).
- **Tempos** — barras de Δuser/Δwall por config em **escala fixa de −50% a
  +25%** (para comparar geometry/attribute e slow/fast sem o intervalo mudar).
  Abaixo, dois gráficos de curvas r1→r5 com o **base em tracejado**:
  tempo × PSNR e tempo × bitrate, com o eixo Y compartilhado entre os dois.
  O eixo Y pode ser tempo absoluto (s) ou Δ% contra o base, e o tempo pode
  alternar entre **user** e **wall** no cabeçalho do card. Na direita, as 10
  repetições brutas de uma célula escolhida, com mediana/média e estatísticas.
- **Sobre** — metodologia, flags exatos de cada config e origem dos dados.

## Filtros

Na sidebar: velocidade, modo, plano, **preenchimento do mapa**, região do
PSNR, eixo X, sequências, configurações e taxas (com "rotular r1…r5"). O
preenchimento é um grupo de chips multi-seleção (`todos` / `nenhuma`), com os
quatro métodos medidos: `patchExtension`, `bbpe`, `pushPull` e `none`. Ele
funciona como sequências e taxas: filtra os gráficos, enquanto as tabelas e
o mapa de calor acumulam os métodos selecionados. Há atalhos para
`base + depth`, `base + QP`, `base + skip`, e "resetar". As curvas RD
sempre incluem o `base` como referência e agregam as sequências selecionadas.

A aba **Pareto** é a exceção: ela usa velocidade, modo, plano, **região de
PSNR e preenchimentos** da sidebar, e ignora os chips de configurações,
sequências e taxas, porque o BD-rate é definido sobre as 5 sequências × 5
taxas. Trocar a região ou os preenchimentos recalcula BD-rate e ΔQ (e o tempo
quando muda o número de preenchimentos); trocar `IC95%` não refaz o tempo. Com um só preenchimento marcado o resultado é idêntico ao relatório;
com vários, o tempo soma as medianas e o BD-rate é a média geométrica das
curvas por (sequência, preenchimento). Se nenhum estiver marcado, a aba usa
os quatro por convenção e avisa. Na geometria os quatro são idênticos em
bytes/PSNR, então agregá-los não altera a decisão.

## Regenerar os dados

A partir da raiz desta pasta (`Experimentos_UVGVPCC_occupancy`), depois de
atualizar o CSV consolidado:

```bash
python3 _output/2026-11-27-084428_metrics_80k_fleet_4fills/build_site_data.py
```

O `data.js` é o único arquivo que precisa ser regenerado quando os números
mudam. Verificado em Chrome headless em 800, 1280 e 1600 px, sem erros de
console e sem overflow horizontal.

A versão pública é o branch `gh-pages` de `gustavohubner/kvazaar-occupSkip`
(https://gustavohubner.github.io/kvazaar-occupSkip/). Depois de mudar os
arquivos aqui, é preciso publicar esse branch também — editar esta cópia não
atualiza o GitHub Pages sozinho.
