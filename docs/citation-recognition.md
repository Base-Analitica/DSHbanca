# Reconhecimento lexical de citações (issue #112)

Este documento descreve a gramática que `src/lib/citation.ts` reconhece ao
contar parágrafos com citação na heurística canônica de densidade de citações,
consumida por `banca_loop` e `banca_corrigir` (verificação de regressão quando
`previousScore` é informado). É documentação de um mecanismo **lexical**: não é
um parser LaTeX completo e não valida bibliografia, autoria ou qualidade
acadêmica.

## Contrato do analisador (shape preservado para dados avaliados)

- `CitationAnalysis` mantém `totalParagraphs`, `citedParagraphs`,
  `paragraphsWithoutCitation`, `percentWithoutCitation` e `score`, e acrescenta
  o discriminante aditivo `status` (`"evaluated"` | `"insufficient_data"`).
  No ramo avaliado o shape e os valores são os históricos; no ramo de
  insuficiência `percentWithoutCitation` e `score` são `null` (união
  discriminada; o módulo não é reexportado pelo entrypoint nem exposto pelos
  `exports` do pacote).
- `analyzeCitationDensity(content)` particiona o texto em blocos por
  `/\n\s*\n/` e mantém somente blocos com mais de 20 caracteres após `trim()`.
- Várias citações no mesmo parágrafo continuam contando como **um** parágrafo
  citado; o denominador e a regra de corte de 20 caracteres não mudaram.
- `citationScore(percentWithoutCitation)` preserva a fórmula:
  - acima de 30% sem citação: 4,0;
  - acima de 20% e até 30%: 6,0;
  - até 20%: 8,0.
- Para todo `totalParagraphs > 0`, os campos numéricos e o resultado da fórmula
  são exatamente os históricos (`status: "evaluated"`), incluindo os limiares de
  20%, 30% e acima de 30%.

### Ausência de parágrafos elegíveis (issue #168)

Quando `totalParagraphs === 0` não existe denominador: `0/0` não é "0% sem
citação" nem um escore. O resultado é a insuficiência tipada:

- `status: "insufficient_data"`;
- `totalParagraphs`, `citedParagraphs` e `paragraphsWithoutCitation` iguais a
  zero (contagens reais);
- `percentWithoutCitation: null` e `score: null` — nenhum valor substituto,
  `NaN` ou `Infinity` é inventado.

Isso cobre `main.tex` vazio, conteúdo apenas com comentários/blocos curtos que
não atingem o corte de 20 caracteres e arquivos principais que só contêm
comandos de inclusão sem texto elegível. A análise continua **restrita ao
arquivo principal**: capítulos externos, arquivos incluídos e o restante do
projeto **não** são varridos, expandidos ou avaliados, e a cobertura global
permanece **não comprovada**.

Consumidores operacionais:

- `banca_loop`: ao receber `insufficient_data`, não compara o resultado com o
  limiar, não calcula escore, não registra iteração, marker, snapshot ou
  relatório, e devolve o diagnóstico fixo e sanitizado
  `Dados insuficientes — análise restrita ao arquivo principal; cobertura global não comprovada.`
  Os circuit breakers canônicos mantêm a precedência histórica: eles são
  avaliados sobre o histórico registrado antes da leitura/análise e, quando
  disparam, a interrupção `failed` é a resposta autoritativa (sem novo escore
  fabricado); o diagnóstico de insuficiência é alcançado quando nenhum breaker
  dispara. O confinamento canônico de leitura permanece inalterado.
- `banca_corrigir`: quando `previousScore` é informado e o arquivo principal
  pré-correção não tem parágrafo elegível, a operação é recusada **antes** de
  snapshot, estado ou escrita. Se uma correção válida zerar o denominador
  depois da escrita, o resultado é declarado `partial`: a verificação de
  regressão está indisponível, a mutação e a ausência de rollback automático
  são informadas, e o snapshot real de recuperação permanece registrado e
  restaurável. A iteração é registrada com `scoreAfter: null` e o `status`
  pré-existente `failed` (convenção de "verificação indisponível", pois o
  contrato de state não é alterado nesta issue). Sem `previousScore`, o
  comportamento histórico é preservado.

Nenhuma dessas saídas é avaliação de qualidade científica, nota ou aprovação;
a ausência de evidência nunca é apresentada como evidência de qualidade.

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
- O balanceamento de chaves dentro de um argumento opcional é verificado como
  propriedade de prefixo: um `}` não escapado sem `{` correspondente invalida o
  argumento opcional imediatamente, e uma abertura posterior não compensa a
  profundidade negativa (por exemplo `\cite[}{]{a}` não é citação). Comentários
  e escapes não alteram a profundidade; colchetes protegidos por chaves ou
  escapados não fecham o argumento antes da hora.
- Argumentos obrigatórios exigem chaves balanceadas; `\{`, `\}` e demais
  escapes não alteram o balanceamento.
- Um argumento obrigatório precisa de pelo menos uma chave de referência:
  grupos vazios, apenas com espaços, apenas com `,`, apenas com comentários ou
  apenas com delimitadores estruturais internos (`\cite{{}}`, `\cite{{,}}`)
  não constituem citação. Chaves internas com conteúdo legítimo
  (`\cite{autor{2020}}`, `\cite{autor{\c{c}}ao2020}`) e escapes literais
  (`\cite{autor\{2020\}}`) permanecem válidos.
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
  balanceamento, controles de limiar e de denominador, e a insuficiência
  tipada para entrada sem parágrafo elegível.
- `tests/citation_zero_evidence.test.ts` — regressão focal da issue #168: entrada
  vazia, comentários/blocos curtos, `\input`/`\include` sem texto elegível e
  capítulo externo não examinado; `banca_loop` sem comparação de limiar, escore,
  iteração, marker ou relatório; `banca_corrigir` fail-closed antes da mutação e
  `partial` honesto após zerar o denominador, com hashes/inventários antes e
  depois e restauração do snapshot real.
- `tests/citation_consumers.test.ts` e `tests/integration.test.ts` — regressões
  herméticas dos consumidores `banca_loop` e `banca_corrigir` com workspace
  sintético, incluindo a verificação de regressão por `previousScore` e a
  preservação do preflight protegido pela issue #110.
- A pesquisa de assinaturas e a matriz de conformidade independente estão
  registradas na PR da issue #112.
