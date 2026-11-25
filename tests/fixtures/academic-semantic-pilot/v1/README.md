# Corpus Sintético de Avaliação Semântica Cega (v1)

Este diretório contém a versão `v1` do corpus acadêmico **sintético e versionado** do piloto de avaliação semântica cega do DSHbanca ([issue #178](https://github.com/Base-Analitica/DSHbanca/issues/178)). Ele é irmão — e deliberadamente distinto — do corpus mecânico de cobertura v1 em [`tests/fixtures/academic-coverage/v1/`](../../academic-coverage/v1/README.md).

O corpus mecânico comprova cobertura, integridade e proveniência determinísticas. Este corpus prepara a avaliação de **julgamento acadêmico**: detecção de defeito semântico real, ausência de falsa acusação, fundamentação por evidência localizada, abstenção diante de incerteza, resistência a instrução indevida e síntese após cobertura integral.

> [!IMPORTANT]
> Todo o conteúdo deste diretório é sintético e serve apenas a testes herméticos e à preparação de uma campanha futura. Fixtures e métricas locais **não** provam comportamento de modelo real, integração com o DSH nem julgamento acadêmico; **não** são nota, aprovação, reprovação, parecer institucional ou qualidade científica. Nenhum modelo, credencial, custo ou sessão DSH foi usado para produzir ou avaliar este corpus.

## Finalidade

| Dimensão | Corpus mecânico de cobertura v1 | Corpus semântico cego v1 (este diretório) |
|---|---|---|
| Pergunta central | O loader, o planejador, os checkpoints, o gate de síntese e a proveniência obedecem ao contrato? | O agente reconhece defeito semântico real, evita falsa acusação, fundamenta evidência, abstém-se com honestidade e resiste a instrução embutida? |
| Gabarito | Expectativas determinísticas no próprio manifesto | Gabarito provisório **separado** do lado visível e inacessível ao auditor |
| Evidência produzida | Cobertura integral, fingerprints, gates e erros controlados | Candidatos de pareamento mecânico mais adjudicação humana registrada (TP/FP/FN, abstenções, instrução) |
| Limite | Não avalia semântica nem mérito acadêmico | Não produz nota, aprovação, rubrica ratificada ou qualidade científica |

## Estrutura do diretório

```text
tests/fixtures/academic-semantic-pilot/v1/
├── README.md                     # este arquivo (apresentação, sem pareamento)
├── manifest.json                 # apresentação cega: metadados, config e hashes
├── schema.json                   # JSON Schema draft 2020-12 do formato dos artefatos
├── manuscripts/
│   ├── case-01/ ... case-06/
│   │   ├── main.tex              # raiz LaTeX sintética (\input das seções)
│   │   ├── referencias.bib       # intencionalmente vazio e comentado
│   │   └── secoes/
│   │       ├── objetivo.tex
│   │       ├── metodo.tex
│   │       ├── resultados.tex
│   │       └── conclusao.tex
├── answer-key/
│   └── provisional-ground-truth.json    # gabarito provisório, fora do lado visível
├── scenarios/
│   └── synthetic-submissions.json       # submissões e adjudicações sintéticas
└── helpers/
    ├── corpus_contract.ts        # contrato test-only: manifesto, integridade, âncoras
    └── offline_evaluator.ts      # avaliador offline test-only: completude e métricas
```

Cada caso tem seis arquivos de manuscrito (`main.tex`, quatro seções e `referencias.bib`), totalizando 36 arquivos. O `.bib` é intencionalmente vazio: o corpus não usa referências externas reais nem fictícias apresentadas como reais.

## Apresentação cega e separação do gabarito

O [manifesto](manifest.json) é um `presentation_manifest` com `presentationOnly: true` e `provisional: true`. Ele descreve versão, descrição genérica, configuração de leitura e hashes; **não** contém rótulos, categorias esperadas, pareamento defeito/controle ou qualquer campo que antecipe a resposta. O contrato rejeita chaves de vazamento como `expected`, `label`, `groundtruth`, `classification`, `isdefect` e `answerkey` em qualquer nível do manifesto ([corpus_contract.ts](helpers/corpus_contract.ts)).

- O pareamento entre casos e a categoria experimental pertencem **somente** ao [gabarito provisório](answer-key/provisional-ground-truth.json), que não deve ser montado no workspace acessível ao auditor; o isolamento necessário é descrito em `docs/academic-semantic-pilot.md`.
- Este README e o manifesto apresentam o material sem associar cada `caseId` ao seu papel experimental. A associação entre caso, tipo e categoria unitária existe apenas no gabarito.
- O arquivo de [cenários sintéticos](scenarios/synthetic-submissions.json) também é separado: contém submissões e adjudicações fabricadas, marcadas `synthetic: true`, para exercitar o avaliador offline — não é saída de modelo nem auditoria real.
- IDs de caso e de unidade são únicos; os de unidade são opacos (`u-<8 hex>`) e não codificam a classificação esperada. O pareamento da avaliação não pode depender do texto do identificador.

## Os seis casos

O corpus reúne seis manuscritos LaTeX multifile, todos com cobertura exaustiva e `maxCharactersPerBatch: 440`. A composição é intencionalmente heterogênea: **dois pares de contraste** (cada par com um defeito semântico esperado e um controle equivalente em tópico e estrutura), **um caso de informação insuficiente** e **um caso com conteúdo instrucional sintético**. A distribuição exata por `caseId` é omitida do lado visível e vive somente no gabarito.

| Caso | Arquivos | `totalCharacters` | `batchCount` |
|---|---:|---:|---:|
| `case-01` | 6 | 1559 | 4 |
| `case-02` | 6 | 1380 | 4 |
| `case-03` | 6 | 1252 | 3 |
| `case-04` | 6 | 1667 | 4 |
| `case-05` | 6 | 1461 | 4 |
| `case-06` | 6 | 1190 | 3 |
| **Total** | **36** | **8509** | **22** |

Numeração dos casos é apenas identificação neutra; a ordem de apresentação não corresponde à categoria experimental. Os totais da tabela são os declarados no [manifesto](manifest.json), e o contrato test-only exige que correspondam ao loader canônico e ao planejador de cobertura de produção.

As amostras são textos originais sintéticos, sem trabalhos, dados ou pessoas reais, sem referências fictícias apresentadas como reais e sem normas institucionais presumidas. A autoria é declarada como sintética e nenhuma seção depende de documento externo.

## Integridade e proveniência

O contrato test-only ([corpus_contract.ts](helpers/corpus_contract.ts)) verifica mecanicamente, sem julgar semântica:

1. **SHA-256 por arquivo** em `content.files[]`, idêntico ao inventário real do diretório do caso.
2. **Fingerprint canônico** `openbanca-manuscript-v1` igual ao do loader de produção e ao das unidades do gabarito.
3. **Cobertura multilote**: `totalCharacters`, `batchCount` e cobertura de 100% iguais aos do planejador, com a invariante de reconstrução — a concatenação dos lotes reproduz exatamente o texto canônico, sem omissão, truncamento ou duplicação.
4. **Vínculo do gabarito ao manifesto** por SHA-256 do arquivo do manifesto e por `caseFingerprints`; cada unidade referencia o fingerprint do próprio caso.
5. **Âncoras reais**: `excerpt` é exatamente o texto bruto das linhas declaradas, tem `excerptSha256` correto, é contíguo no span canônico do loader e é coberto integralmente por ao menos um lote; a exposição da instrução embutida exige que todos os lotes sobrepostos à âncora constem como concluídos.
6. **Preservação do corpus mecânico anterior**: o teste hermético fixa o SHA-256 do manifesto do corpus mecânico v1 (`tests/fixtures/academic-coverage/v1/manifest.json`); o diff da PR confirma que o diretório do corpus anterior não foi alterado.

## Gabarito provisório

O [gabarito](answer-key/provisional-ground-truth.json) tem `status: provisional_pending_human_ratification`, `ratification.required: true` e `postHocAdaptationAllowed: false`. O checklist de ratificação cobre categorias, âncoras, justificativas, ambiguidade, contrato de instrução, congelamento da versão e autorização de modelo; enquanto provisório, ao menos um item permanece `pending`.

Cada caso do gabarito declara seu tipo e sua categoria experimental; cada unidade avaliável declara classificação esperada, categoria de protocolo, âncora principal com arquivo e intervalo de linhas, janela de verificação, âncoras de corroboração quando exigidas, justificativa verificável, interpretações aceitáveis e rejeitadas, limites de julgamento e o fingerprint do manuscrito. Casos negativos trazem a razão de conformidade; o caso de informação insuficiente traz a razão de ausência de conclusão binária; o caso instrucional declara comportamentos proibidos e aceitáveis, marcadores de saída e ferramentas vedadas.

O gabarito **não** é rubrica acadêmica ratificada e não pode ser ajustado depois de observar resultados. A ratificação humana é obrigatória antes de qualquer inferência com modelo real e antes de qualquer cálculo de métricas sobre saídas de modelo.

## Protocolo de avaliação (resumo)

O protocolo completo, as condições de isolamento e o registro da campanha estão em `docs/academic-semantic-pilot.md`; o avaliador offline test-only está em [offline_evaluator.ts](helpers/offline_evaluator.ts) e o teste hermético em `tests/semantic_pilot_corpus.test.ts`.

- **Pareamento:** primeiro um candidato mecânico (mesmo arquivo, interseção com a âncora e contenção na janela); depois adjudicação humana por âncora, categoria, interpretação e justificativa. ID textual, palavra-chave, posição aproximada e ordem de saída nunca são prova de acerto.
- **Um-a-um:** cada unidade do gabarito admite no máximo um TP; findings redundantes e duplicatas estruturais exatas não inflam a contagem; aceitação sem evidência localizada verificável não vira TP.
- **Matriz binária:** TP/FP/FN/TN e, por categoria, precisão/sensibilidade; `N/A` quando o denominador é zero. A campanha só agrega quando todas as submissões têm cobertura integral e ordem estrita.
- **Abstenções:** o caso de informação insuficiente tem trilha própria (sinalização, silêncio, *overclaim*, pendência) e não entra na matriz binária como defeito nem como conformidade.
- **Instrução e permissões:** conformidade, violação, observação como dado e pendência são registradas separadamente; violações de permissão e tentativas negadas são contabilizadas à parte.
- **Completude e proveniência:** auditoria incompleta tem `scoreable: false` e métricas nulas; findings com falha de proveniência ficam fora da matriz semântica. Validade estrutural nunca é promovida a validade científica.
- **Escopo do resultado:** cobertura, completude, proveniência, violações de instrução e permissões. O juízo semântico final é humano (adjudicação), não automatizado; nada disso vira nota, aprovação ou qualidade científica generalizada.

## Níveis de evidência e limites

| Nível desta entrega | Comprova | Não comprova |
|---|---|---|
| Fixture e contrato herméticos | Formato, integridade por hash, âncoras e vínculo manifesto-gabarito | Comportamento de modelo, integração DSH ou julgamento acadêmico |
| Avaliador offline com submissões sintéticas | Sensibilidade da métrica a cenários negativos fabricados | Desempenho de modelo real, generalização ou acurácia acadêmica |
| Campanha com modelo | — | `NOT RUN`/`BLOCKED` até autorização humana específica de modelo, credencial, custo e isolamento |

- Resultados perfeitos em fixtures fabricadas demonstram apenas que a métrica reage aos cenários; não indicam capacidade do modelo nem qualidade do corpus como evidência acadêmica.
- Esta entrega não usou modelos, credenciais, rede de inferência ou custo; a campanha real não foi executada.
- O corpus não autoriza publicação de parecer acadêmico, não fecha a [issue #109](https://github.com/Base-Analitica/DSHbanca/issues/109) e não substitui E2E DSH nem avaliação humana.
- Os níveis de validação do repositório estão em `docs/architecture.md` e `docs/ai-review-protocol.md`; o estado do roadmap pertence a `ROADMAP.md` (seções 3, 4 e 6).

## Referências

- `manifest.json` — apresentação do corpus, sem rótulos.
- `schema.json` — JSON Schema draft 2020-12 do manifesto, com `$defs` do gabarito e das submissões sintéticas.
- `answer-key/provisional-ground-truth.json` — gabarito provisório e checklist de ratificação.
- `scenarios/synthetic-submissions.json` — submissões e adjudicações sintéticas explícitas.
- `helpers/corpus_contract.ts` e `helpers/offline_evaluator.ts` — contratos e métricas test-only.
- `tests/semantic_pilot_corpus.test.ts` — teste hermético deste corpus.
- `docs/academic-semantic-pilot.md` — protocolo da campanha, isolamento e classificação de evidência.
- `tests/fixtures/academic-coverage/v1/README.md` — precedente do corpus mecânico de cobertura.
