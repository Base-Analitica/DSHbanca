# Reconhecimento lexical de citações (issue #112)

Este documento descreve a gramática que `src/lib/citation.ts` reconhece ao
contar parágrafos com citação na heurística canônica de densidade de citações,
consumida por `banca_loop` e `banca_corrigir` (verificação de regressão quando
`previousScore` é informado). É documentação de um mecanismo **lexical**: não é
um parser LaTeX completo e não valida bibliografia, autoria ou qualidade
acadêmica.

## Contrato público preservado

- `CitationAnalysis` mantém `totalParagraphs`, `citedParagraphs`,
  `paragraphsWithoutCitation`, `percentWithoutCitation` e `score`.
- `analyzeCitationDensity(content)` particiona o texto em blocos por
  `/\n\s*\n/` e mantém somente blocos com mais de 20 caracteres após `trim()`.
- Várias citações no mesmo parágrafo continuam contando como **um** parágrafo
  citado; o denominador, o tratamento de conteúdo vazio e a regra de corte de
  20 caracteres não mudaram.
- `citationScore(percentWithoutCitation)` preserva a fórmula:
  - acima de 30% sem citação: 4,0;
  - acima de 20% e até 30%: 6,0;
  - até 20%: 8,0.

## Comandos reconhecidos

Allowlist explícita e exata (nomes completos e sensíveis a maiúsculas). Um
comando só conta quando o nome inteiro coincide; prefixos e sufixos semelhantes
não são inferidos.

| Comando | Assinatura lexical aceita | Origem documentada |
|---|---|---|
| `\cite` | até 2 opcionais + 1 obrigatório | BibLaTeX 3.22a aceita dois opcionais; abntex2cite 1.9.7 usa um |
| `\citeonline` | até 1 opcional + 1 obrigatório | abntex2cite 1.9.7 |
| `\citeauthor` | até 2 opcionais + 1 obrigatório | BibLaTeX 3.22a / forma natbib |
| `\parencite` | até 2 opcionais + 1 obrigatório | BibLaTeX 3.22a |
| `\textcite` | até 2 opcionais + 1 obrigatório | BibLaTeX 3.22a |
| `\apud` | até 1 opcional + 2 obrigatórios não vazios | abntex2cite 1.9.7 (`\apud[3][]`) |
| `\apudonline` | até 1 opcional + 2 obrigatórios não vazios | abntex2cite 1.9.7 (variante documentada, além do mínimo da issue) |

Fontes consultadas: manual do abntex2cite
(<https://tug.ctan.org/macros/latex/contrib/abntex2/doc/abntex2cite.pdf>), código
`abntex2cite.sty` (<https://github.com/abntex/abntex2>), manual do BibLaTeX
(<https://mirrors.ctan.org/macros/latex/contrib/biblatex/doc/biblatex.pdf>) e
manual do natbib (<https://tug.ctan.org/macros/latex/contrib/natbib/natbib.pdf>).

## Regras aceitas

- Argumentos opcionais `[...]` vêm antes dos obrigatórios `{...}`; espaços,
  quebras de linha simples dentro do mesmo parágrafo e comentários não
  escapados são tolerados entre eles.
- Argumentos obrigatórios exigem chaves balanceadas; `\{`, `\}` e demais
  escapes não alteram o balanceamento.
- Um argumento obrigatório precisa de pelo menos uma chave de referência:
  grupos vazios, apenas com espaços, apenas com `,` ou apenas com comentários
  não constituem citação.
- `\apud` e `\apudonline` exigem os **dois** argumentos obrigatórios com
  conteúdo; um único argumento não conta.
- Múltiplas chaves em um argumento (`\cite{autor2020,autor2021}`) contam como
  citação; as chaves não são interpretadas nem validadas.
- `%` não escapado inicia comentário até o fim da linha; `\%` é percentual
  literal e `\\` é um símbolo de controle (quebra de linha). Assim, `\\cite` é
  texto com dois backslashes e **não** é citação, enquanto `\\\cite` é quebra de
  linha seguida de citação e conta.

## Construções não reconhecidas (limitações explícitas)

Esta é uma análise lexical restrita. Não são reconhecidos, e a documentação
não alega suporte a:

- macros definidas pelo usuário, aliases de `\newcommand` e expansão de
  comandos (um alias que expande para `\cite` não será detectado); o corpo de
  uma definição de macro é lido como texto normal, então um `\cite` dentro do
  corpo pode ser contado mesmo que a macro nunca seja usada;
- ambientes verbatim/literal e `\verb`: a análise não identifica esses
  ambientes, portanto um `\cite` exibido como código dentro de `verbatim` pode
  ser contado como citação real;
- variantes estreladas (`\cite*`, `\parencite*`, `\citeauthor*`), que não são
  reconhecidas como citação;
- comandos que atravessam fronteiras de parágrafo: cada parágrafo é analisado
  isoladamente, então `\cite` no fim de um bloco e `{chave}` no seguinte não
  contam;
- comandos com mais opcionais do que a assinatura documentada (por exemplo
  `\cite[a][b][c]{k}` e `\apud[a][b]{x}{y}`), que não são reconhecidos;
- opcionais adicionais depois dos argumentos obrigatórios (`\cite{a}[b]`) não
  fazem parte da assinatura: são lidos como texto e a citação anterior continua
  contada;
- outras variantes de pacotes não listados acima (`\citet`, `\citep`,
  `\citetext`, `\citeyear`, `\nocite`, `\autocite`, `\footcite`,
  `\fullcite`, `\supercite`, `\Cite`, `\citeauthorx`, etc.);
- interpretação de pacotes, de opções de classe ou de configuração ABNT;
  interpretação de ambientes, macros ou condicionais TeX;
- validação da existência bibliográfica, do DOI ou do mérito científico das
  chaves citadas.

Além disso, o scanner usa um orçamento defensivo de trabalho por parágrafo.
Entradas patológicas (por exemplo muitas construções malformadas não
terminadas) podem esgotá-lo; nesse caso o parágrafo é classificado como **não
citado**, nunca como citação.

## Evidência

- `tests/citation.test.ts` — gramática positiva/negativa, comentários, escapes,
  balanceamento, controles de limiar e de denominador.
- `tests/citation_consumers.test.ts` e `tests/integration.test.ts` — regressões
  herméticas dos consumidores `banca_loop` e `banca_corrigir` com workspace
  sintético, incluindo a verificação de regressão por `previousScore` e a
  preservação do preflight protegido pela issue #110.
- A pesquisa de assinaturas e a matriz de conformidade independente estão
  registradas na PR da issue #112.
