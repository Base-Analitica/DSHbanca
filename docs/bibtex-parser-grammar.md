# Parser BibTeX do DSHbanca — gramática suportada e limitações

Este documento descreve o contrato do parser determinístico de referências em
[`src/lib/bibtex.ts`](../src/lib/bibtex.ts), consumido por `banca_refs`. Ele não
promete a linguagem BibTeX completa: delimita deliberadamente a gramática
aceita, o que é rejeitado com erro identificável e o que permanece fora do
escopo. A mudança pertence à issue #111.

## Contrato público preservado

- `BibEntry { type, key, fields }`
- `parseBibtex(content: string): BibEntry[]` — devolve as entradas na ordem do
  arquivo para conteúdo válido; lança `BibtexParseError` para conteúdo
  malformado ou não suportado.
- `bibEntryToRef(entry: BibEntry): RefMetadata` — inalterado; apenas consome os
  campos já normalizados pelo parser.

Normalizações existentes preservadas: tipo da entrada e nomes de campos em
minúsculas, chave e valores aparados nas extremidades (`trim`), primeira
ocorrência de `date`/`year` para o ano e divisão de autores por `and`.

## Gramática suportada

### Itens de topo

- Entradas `@tipo{...}` ou `@tipo(...)`, com delimitadores externos coerentes:
  uma entrada aberta com `{` fecha com `}`; uma entrada aberta com `(` fecha
  com `)`. Espaços entre `@`, tipo e delimitador são tolerados.
- `@comment{...}` e `@preamble{...}` (ou com parênteses) são reconhecidos e
  **ignorados de forma deliberada**: não são devolvidos como referências e o
  corpo é saltado com balanceamento de delimitadores.
- Texto fora de entradas é ignorado, como no BibTeX. Exceção: todo `@` fora de
  uma entrada precisa iniciar um item bem formado; um `@` solto (por exemplo
  um endereço de e-mail fora de uma entrada) gera erro em vez de ser ignorado
  silenciosamente.
- Arquivo vazio, só com espaços ou só com texto/comentários sem `@` produz
  `[]` — um arquivo vazio válido é diferente de um arquivo cuja sintaxe falhou.

### Entradas

- Chave de citação não vazia, lida até a primeira vírgula, aparada.
- Zero ou mais campos `nome = valor` separados por vírgula; a vírgula final
  antes do fechamento é aceita. Nome de campo: `[A-Za-z][A-Za-z0-9_-]*`
  normalizado para minúsculas.
- Campos duplicados são rejeitados: manter um dos valores seria metadado
  ambíguo, então o parser falha fechado.

### Valores de campo

- **Chaves balanceadas** `{...}`: chaves internas de proteção de capitalização e
  comandos LaTeX são preservados literalmente; apenas o par externo é removido.
  `\{` e `\}` são tratados como conteúdo escapado e não alteram o
  balanceamento. O conteúdo não é interpretado como LaTeX.
- **Aspas** `"..."`: chaves internas continuam balanceadas, `\"` é escapado
  literal e não encerra o valor, e `@`, vírgulas, sinais de igual e demais
  caracteres são preservados. Apenas as aspas externas são removidas.
- **Número inteiro sem delimitador** (`year = 2026`): aceito como literal
  decimal não negativo. Valores como `2020a` ou `2020.5` são rejeitados.
- Conteúdo de campos mantém a normalização de `trim` já existente.

### Erros identificáveis

`BibtexParseError` expõe `kind` (`"malformed"` ou `"unsupported"`), `line`,
`column` e `offset` (1-based para linha/coluna). A mensagem indica o motivo e a
posição. O parsing é **tudo ou nada**: qualquer construção inválida ou não
suportada em qualquer ponto do arquivo falha o parse inteiro; o parser nunca
devolve uma lista parcial que possa ser confundida com bibliografia completa.

## Construções não suportadas (rejeição explícita)

Não são implementadas nesta issue e falham com `kind: "unsupported"`, em vez de
produzir campos truncados ou inventados:

- definições de macro `@string{...}`;
- referências a macros como valor sem delimitador (`month = jan`);
- concatenação de strings com `#` (`title = "A" # "B"`, `"X" # macro`).

A orientação é usar valores literais entre chaves ou aspas. O parser não
resolve macros nem expande concatenação, e não promete compatibilidade com
arquivos que dependam delas.

## Limitações remanescentes

- Não é um parser BibTeX completo: não implementa macros, `@string`,
  `#`, arquivos `.bst`, ordenação, abreviações de mês ou validação semântica.
- Não valida se a referência existe, não consulta rede/MCP/REST e não
  interpreta, corrige ou completa metadados.
- Comandos LaTeX são preservados byte a byte, sem interpretação (por exemplo,
  `{\c{c}}` não é convertido para `ç`).
- Tipos de entrada desconhecidos são aceitos como entradas genéricas (o parser
  não mantém uma lista fechada de tipos), assim como no comportamento anterior.
- O sinal `%` não abre comentário dentro de uma entrada; texto fora de entradas
  é ignorado. Para conteúdo com `@` fora de entradas, use `@comment{...}`.
- `@xdata` e outras extensões do biblatex não recebem tratamento especial.
- Não há tolerância a múltiplos erros: a primeira falha interrompe o parse.
- Chaves de citação duplicadas não são deduplicadas: cada ocorrência vira uma
  entrada, e o parser não decide qual delas é a correta.
- O conteúdo de `@comment`/`@preamble` precisa ter delimitadores balanceados
  (com escapes) para ser saltado; construções desbalanceadas falham com erro.
- Erros em entrada não terminada no fim do arquivo apontam para o início da
  entrada (e não para o EOF), preservando a linha/coluna onde ela começa.

## Uso pelo consumidor `banca_refs`

`banca_refs` lê o `.bib` no caminho configurado (com os guards de contenção de
caminho existentes) e então:

- em sucesso, converte cada entrada em `RefMetadata` e consulta o mecanismo de
  referências existente (cache primeiro; provedor nativo ausente = referência
  explicitamente **bloqueada**, sem rede/MCP);
- em erro de parsing, retorna `bib parse error: <motivo e posição>` **antes** de
  qualquer resolução e **sem** gravar relatório normal de validação.

As mensagens do consumidor permanecem distinguíveis entre si:

| Situação | Resposta |
|---|---|
| Arquivo ausente | `bib not found: <caminho público>` |
| Arquivo válido sem entradas | `no entries found in bib file` |
| Arquivo malformado/não suportado | `bib parse error: ...` |
| Referência sem cache e sem provedor DSH | prefixo `blocked: ...` e contagem de bloqueadas |

O parser interpreta metadados; ele **não** declara uma publicação verdadeira
apenas porque a sintaxe BibTeX é válida. Validação externa de referências
continua sujeita ao contrato de provedores do DSH.

## Evidência de regressão

- [`tests/bibtex.test.ts`](../tests/bibtex.test.ts): fixture da issue #111
  (`title` com `{ABNT}`/`{Brasil}`, `author` com `{\c{c}}`, `journal` entre
  aspas), escapes, `@`/vírgulas/`=` em valores, múltiplas entradas, diretivas,
  normalização e casos negativos com `kind`/posição.
- [`tests/banca_refs_bibtex_consumer.test.ts`](../tests/banca_refs_bibtex_consumer.test.ts):
  workspace sintético hermético provando metadados completos na fronteira do
  cache, cache hit por DOI entre aspas, cache miss bloqueado, erro de parsing
  distinguível de arquivo ausente/vazio, ausência de relatório parcial e
  preservação de originais e guards de path.

Nenhum teste desta issue executa rede, MCP, REST, LLM ou LaTeX/BibTeX real.

