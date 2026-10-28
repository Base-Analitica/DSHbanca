# Corpus Acadêmico Sintético de Cobertura (v1)

Este diretório contém a primeira versão (`v1`) do corpus acadêmico sintético e versionado do **DSHbanca**, projetado exclusivamente para testes de regressão herméticos dos contratos determinísticos de cobertura, checkpoints, retomada e síntese.

## Distinção Arquitetural e Níveis de Validação

Para assegurar rigor metodológico e integridade conceitual, o DSHbanca distingue categoricamente os diferentes níveis de evidência e validação:

| Nível | Escopo e Capacidade Comprovada | Limitações Inerentes |
|---|---|---|
| **Corpus Sintético (`v1`)** | Validação automatizada de regras matemáticas e sintáticas determinísticas: contagem de caracteres UTF-16, corte de lotes sem truncamento, monotonicidade de checkpoints, proveniência por linha/arquivo e gate de síntese. | **Não** é validação acadêmica institucional, **não** usa trabalhos reais (TCCs/dissertações) e **não** substitui julgamento humano. |
| **Unit Tests (`bun test`)** | Testes de funções isoladas e contratos de tipos no runtime TypeScript/Bun. | Não exercita descoberta no host nem lifecycle de agentes. |
| **LaTeX Real** | Compilação e tipografia por engines TeX (`lualatex`, `bibtex`). | Não analisa conformidade semântica nem gera pareceres. |
| **DSH Real sem Modelo** | Exercício do host DeepSeek Harness: registro nativo de ferramentas, lifecycle Cordis, permissões e dispatch. | Não afere qualidade textual nem raciocínio analítico. |
| **Modelo de Linguagem (LLM)** | Inferência probabilística contextual sob prompts específicos. | Comportamento não-determinístico; requer isolamento e medição explícita de custos. |
| **Avaliação Humana da Banca** | Julgamento acadêmico soberano sobre mérito científico, originalidade e adequação metodológica. | Insubstituível por qualquer automação. |

> [!IMPORTANT]
> A existência de sucesso neste corpus sintético comprova a integridade mecânica dos algoritmos determinísticos. Não deve ser interpretada como validação em corpus real de instituições de ensino nem como nota de aprovação acadêmica.

---

## Estrutura do Manifesto (`manifest.json`)

O arquivo [manifest.json](file:///home/pedro/Projetos/miscellaneous/DSHbanca/tests/fixtures/academic-coverage/v1/manifest.json) define formalmente:

- `version`: versão do contrato do corpus (`academic-coverage-corpus-v1`);
- `cases`: lista de 10 casos de teste cobrindo 4 classes obrigatórias:
  1. **Correto (`correct`)**: manuscrito estruturado canônico, sem defeitos;
  2. **Fronteira (`boundary`)**: span superior a `maxCharactersPerBatch`, limites de substituição UTF-16 (surrogates) e retomada de checkpoint serializado em múltiplos passos;
  3. **Defeito (`defective`)**: arquivos ausentes (`include_not_found`), ciclos de inclusão (`include_cycle`), adulteração de checkpoint (`tampered_checkpoint`) e desvio de proveniência de finding (`invalid_findings`);
  4. **Ambíguo (`ambiguous`)**: trechos com anotações abertas sem regra determinística objetiva, classificados separadamente como não-pontuáveis.

---

## Regras Determinísticas Cobertas

1. **`canonical_loader_integrity`**: leitura canônica ordenada, resolução segura de caminhos relativos POSIX, detecção de ausência e ciclos sem vazamento de caminhos absolutos do host.
2. **`exhaustive_coverage_bounds`**: partição de todo o manuscrito em lotes de no máximo `maxCharactersPerBatch` caracteres UTF-16, garantindo que o somatório dos fragmentos corresponda a 100% da obra sem truncamento.
3. **`checkpoint_deterministic_resume_and_tamper`**: avanço sequencial estrito de lotes, idempotência em re-execução, invariância na serialização/desserialização JSON e rejeição de adulterações de progresso ou identificador de plano.
4. **`synthesis_gate_closed_on_partial_or_blocked`**: bloqueio determinístico da síntese (`blocked_plan` ou `incomplete_coverage`) quando o plano não atinge cobertura integral.
5. **`finding_provenance_and_plan_binding`**: vínculo inviolável entre findings, fingerprint do manuscrito, plano, lote e janela textual delimitada por linhas.

---

## Matriz de Classificação e Casos Ambíguos

Para os casos com regra objetiva fechada:
- **Positivo**: detecção de defeito ou inconformidade estrutural (casos 4, 5, 7, 8).
- **Negativo**: conformidade com os contratos determinísticos (casos 1, 2, 3, 6, 9).
- **Ambíguo**: casos subjetivos ou não classificáveis por contrato puramente determinístico (caso 10) são mantidos fora da matriz binária para evitar inflação artificial de taxas de precisão.

### Avaliação Observada e Invariante de Sensibilidade

A matriz de confusão não infere detecção pelo identificador (`caseDef.id`) ou metadado da fixture. Cada caso é submetido à execução efetiva do seu validador determinístico correspondente:
- Casos de manuscrito (04 e 05): avaliados pela integridade canônica do loader (`loadCanonicalLatexManuscript`).
- Caso 07: submetido à validação de checkpoint desserializado (`nextAnalysisBatch`), onde adulterações geram `AnalysisCheckpointError`.
- Caso 08: submetido à validação de proveniência de finding (`createAnalysisFinding`), onde violações de linha/lote geram `AnalysisFindingError`.
- Caso 06: validação do status `partial` da estratégia prefixada (`planAnalysisCoverage`). O contrato da API `createGlobalAnalysisSynthesisInput` restringe-se a planos exaustivos (`ExhaustiveAnalysisPlan`), de modo que planos de prefixo são inelegíveis para síntese global por desenho contratual.
- Testes negativos de sensibilidade provam que mutações ou supressões de detecção produzem imediatamente Falsos Negativos (FN) e derrubam as taxas da matriz, eliminando resultados artificiais de 100%.
