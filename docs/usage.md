# Guia de uso e estado operacional do DSHbanca

## Visão geral e limites

O **DSHbanca** é uma camada acadêmica experimental para o **DSH (DeepSeek Harness)**, seu único harness, com integração declarada via **Cordis**. O DSH é responsável por runtime, modelos e autenticação, sessões, identidade/lifecycle de agentes, dispatch, permissões, plugins, skills e configuração do ambiente. O DSHbanca cuida de manuscrito, cobertura por lotes, checkpoints, rubricas, findings com proveniência, validações, snapshots e guardrails acadêmicos.

Essa divisão é normativa, não prova de funcionamento. Consulte o [README](../README.md), a [governança](../AGENTS.md), a [arquitetura](architecture.md) e o [protocolo de revisão](ai-review-protocol.md). OpenBanca/OpenCode pertence a outro projeto; referências a esse harness no código são **legado não suportado**, não compatibilidade dual nem fallback operacional do DSHbanca.

## O que está disponível e o que falta provar

Referência desta revisão: `origin/master` em `66049be57123ddd5ff7d0dec3c3cba2d5db36f4f` para os estados operacionais desta página, consultados em 22/10/2026. O contrato de `banca_refs` foi reconciliado com o SHA `f6786df972ac574d7a36eda99f43cdc6f42a38f9` (issue #122). Revalide estados de PRs e issues antes de usar uma revisão posterior.

| Nível | Estado verificado | Limite |
|---|---|---|
| Código na master | [Pacote](../package.json) experimental `0.1.0`, `private: true`, `UNLICENSED`; export `./dsh` e [patch Cordis](../cordis.patch.yml) apontando para `dshbanca/dsh`. O [entry DSH](../src/dsh.ts) registra provider de skills quando o serviço existe. | Não comprova carregamento ou discovery no host. Não há registro de tools nem guard DSH nesse entry na base. |
| Inventário na master | **16 módulos de ferramentas** em [src/tools](../src/tools/), expostos pelo [entry principal](../src/index.ts), ainda baseado em `@opencode-ai/plugin` (legado não suportado); **8 skills** em [skills](../skills/). | Módulos e arquivos Markdown não provam invocação nativa, associação ao Agent ou projeção de instruções. |
| Proposta não incorporada | A [PR #1](https://github.com/Base-Analitica/DSHbanca/pull/1), draft/`CHANGES_REQUESTED`, HEAD consultado `c6e7bd5`, propõe tools via `ctx.tools`, guard read-only, preset do auditor e gate de perfil DSH. | Não é funcionalidade disponível na master. Resultados históricos valem somente para o SHA e as etapas observados. |
| Testes unitários e CI | Há testes de [checkpoints](../tests/analysis_checkpoint.test.ts), [findings](../tests/analysis_findings.test.ts) e [entrada de síntese](../tests/analysis_synthesis.test.ts). A [CI](../.github/workflows/ci.yml) executa typecheck, build, testes e validações. | Testes isolados demonstram os casos exercitados; CI convencional não comprova DSH real, modelo ou qualidade acadêmica. |
| E2E DSH real no SHA final | **Não comprovado.** A [issue #3](https://github.com/Base-Analitica/DSHbanca/issues/3) segue bloqueada para consumo do Markdown do auditor; a [#4](https://github.com/Base-Analitica/DSHbanca/issues/4), sobre decisões por opções, depende dela. | Arquivo instalado, nome de preset e registro declarado não são prova de execução. |

**Ainda não existe procedimento funcional validado de instalação e invocação dessas operações no DSH a recomendar.** Este guia não fornece slash commands nem inventa CLI do host. O preparo abaixo não instala funcionalmente o plugin. A integração DSH permanece pendente, inclusive no SHA final desta correção documental ([issue #15](https://github.com/Base-Analitica/DSHbanca/issues/15)).

## 1. Preparar o repositório localmente

Siga o [guia de instalação](install.md) e seus [detalhes e limites](installation.md). Para desenvolvimento local, com Git e Bun disponíveis:

```bash
git clone https://github.com/Base-Analitica/DSHbanca.git
cd DSHbanca
bun install --frozen-lockfile
bun run build
```

Clone e resolução de dependências podem exigir rede; esse preparo não exige iniciar DSH, modelo, credenciais de provedor, MCP externo ou compilação LaTeX. A versão mínima de DSH não foi validada. O pacote não está publicado oficialmente.

Antes de executar testes, leia o [fluxo de terminal](terminal-agent-workflow.md) e os scripts reais. **Não rode a suíte integral sem preflight:** o teste E2E legado pode resolver outro harness automaticamente, copiar autenticação do host e solicitar modelo. Se a segurança não puder ser demonstrada, registre o gate integral como `BLOCKED` e selecione explicitamente apenas testes seguros. CI verde não remove esse bloqueio.

## 2. Entender as operações acadêmicas existentes

Os nomes `banca_*` abaixo identificam módulos/contratos de código, **não comandos CLI nem tools comprovadamente disponíveis no DSH**. Em geral recebem `projectRoot` opcional, ou usam o diretório do contexto. Exigem configuração e arquivos compatíveis com a operação; verifique o schema de cada módulo. Não execute sobre manuscrito real sem autorização.

### Preparação e acompanhamento

| Operação e fonte | Comportamento no código e pré-requisitos |
|---|---|
| [banca_init](../src/tools/banca_init.ts) | Cria configuração/estado acadêmico sob `.banca/`, procura engines LaTeX e chama o instalador de assets **legado não suportado**. Não é instalador DSH validado. `force` permite sobrescrita no código, não concede autorização humana. |
| [banca_validate](../src/tools/banca_validate.ts) | Valida a configuração do projeto contra seu schema; não valida integração nem qualidade acadêmica. |
| [banca_status](../src/tools/banca_status.ts) | Mostra configuração, arquivos, relatórios e estado persistido. Score/estado não são prova de cobertura ou aprovação. |
| [banca_checklist](../src/tools/banca_checklist.ts) | Confere presença de arquivos e marcadores LaTeX, como resumo e sumário. Não certifica entrega institucional. |

### Auditoria por lotes e entrada de síntese

| Operação e fonte | Comportamento no código e pré-requisitos |
|---|---|
| [banca_context](../src/tools/banca_context.ts) | Carrega o manuscrito canônico e plano exaustivo, persiste checkpoint/context pack e seleciona o próximo lote. Omitir `completedBatchId` retoma sem avançar; fornecê-lo registra conclusão. Esse registro não comprova leitura ou análise acadêmica. |
| [banca_auditar](../src/tools/banca_auditar.ts) | Exige `manuscriptFingerprint`, `batchId` e `findings` do plano atual; valida proveniência e persiste findings por lote. Não executa modelo, não calcula nota, não avança checkpoint nem faz síntese. |
| [banca_sintese](../src/tools/banca_sintese.ts) | Read-only: exige plano atual, checkpoint persistido completo e findings compatíveis; retorna JSON de **entrada** de síntese global. Não produz síntese semântica, score ou parecer e não chama modelo. |

Sequência conceitual do protocolo, **não receita de execução DSH validada**:

1. Verificar configuração, includes, bibliografia, diagnósticos e fingerprint do manuscrito canônico; não omitir trechos por conveniência.
2. Obter o lote com `banca_context`, ler integralmente o conteúdo e registrar apenas findings sustentados por arquivo, linhas, seção e evidência reais.
3. Submeter findings por `banca_auditar`; só registrar conclusão do lote depois de leitura, análise e persistência bem-sucedidas. Repetir para todos os lotes, sem saltos.
4. Somente após **cobertura integral comprovada**, solicitar a entrada por `banca_sintese`. `partial`/`blocked`, leitura incompleta, fingerprint incompatível, erro ou dados insuficientes impedem síntese conclusiva.
5. O JSON validado é insumo, não parecer: análise relacional e revisão acadêmica humana continuam distintas da validação estrutural. Checkpoint a 100% sozinho não prova execução de modelo nem qualidade da análise.

A [skill banca-avaliacao](../skills/banca-avaliacao/SKILL.md) descreve o protocolo. Sua existência não comprova que o DSH o carregou ou executou.

### Correção autorizada e proteção

| Operação e fonte | Comportamento no código e pré-requisitos |
|---|---|
| [banca_corrigir](../src/tools/banca_corrigir.ts) | Recebe `corrections` com `file`, `oldText`, `newText` e `expectedOccurrences` opcional. Valida o lote **inteiro** em memória antes de qualquer snapshot ou escrita: caminhos, `immutableFacts`, `protectedPaths`, allowlist, existência/tipo/hardlinks, identidade física (destinos duplicados, aliases por symlink/hardlink e o mesmo arquivo repetido continuam bloqueados) e contagem de ocorrências literais não sobrepostas. `expectedOccurrences`, quando presente, deve ser inteiro positivo seguro e igual à contagem real; quando omitido, apenas uma ocorrência é admitida; qualquer divergência, ambiguidade, ausência ou `oldText` vazio bloqueia o lote sem mutação, sem iteração e sem snapshot. `newText` é inserido literalmente (sem template JavaScript como `$&`, `$$`, `$'` ou crase-dólar, e sem regex); conteúdo não UTF-8 é recusado em vez de sofrer normalização silenciosa. Só depois do preflight integral cria snapshot prévio real e registrado (declarado `partial`, restaurável por `banca_restore`), revalida identidade/conteúdo e aplica apenas as substituições planejadas. `skipSnapshot` é bloqueado no fluxo público. `oldText`, `newText` e o resultado planejado precisam ser Unicode bem-formado representável exatamente em UTF-8: surrogates UTF-16 isolados são rejeitados antes do snapshot e o round-trip do conteúdo planejado é verificado (sem normalização nem substituição silenciosa por U+FFFD). Falha de I/O posterior ao início da aplicação é classificada pelo estado real de cada destino — aplicado, possivelmente alterado (identidade e bytes relidos, com sha256 antes/depois) ou não processado — e, quando o destino não pode ser verificado, o estado é declarado indeterminado/potencialmente alterado; nunca se afirma manuscrito intacto sem essa verificação. O snapshot real é preservado para recuperação, a iteração é registrada como `failed`, e não se promete atomicidade multiarquivo nem rollback automático. |
| [banca_snapshot](../src/tools/banca_snapshot.ts) | Copia arquivos do manuscrito resolvidos pela configuração e registra snapshot no estado. Não é backup integral do projeto nem prova de reversibilidade. |
| [banca_restore](../src/tools/banca_restore.ts) | Sem `snapshotId`, lista snapshots; com ID e sem `confirm`, apresenta dry-run. Com `confirm: true`, cria backup prévio e substitui arquivos selecionados conforme a configuração. Exige inspeção e autorização específica; dry-run/backup não garantem restauração íntegra. |
| [banca_contract](../src/tools/banca_contract.ts) | Avalia os alvos de correções declaradas pela identidade canônica confinada, preservando o caminho lógico e reportando por alvo a validade do destino e os estados de proteção (`protectedPaths`), imutabilidade (`immutableFacts`) e allowlist (`allowedPaths`), com os mesmos globs de `banca_corrigir`. `Immutable blocked` e os agregados derivam dos alvos classificados; alvos inválidos (traversal, symlink externo/quebrado, inexistente, não regular, vazio), repetições, aliases e conflito de identidade física são reportados sem autorização. Valores não confiáveis presentes no relatório (nomes e caminhos, padrões e dependências externas, inclusive Unicode inválido como surrogates UTF-16 isolados) são renderizados de forma literal, escapada e não ambígua, e alvos regulares com múltiplos hardlinks (`nlink>1`) são reportados como restrição de identidade física que `banca_corrigir` recusaria. É avaliação de alvos, não autorização de edição, não substitui o preflight de `banca_corrigir`, revisão do diff ou prova de aplicação; `save` persiste somente o relatório em `.banca/reports/contract-*.md`. |
| [banca_loop](../src/tools/banca_loop.ts) | Etapa preparatória/assistida sobre densidade lexical de citações **somente do `main`**, com estado/relatório e detecção de estagnação/oscilação. O valor produzido é um score heurístico local (não é nota acadêmica, cobertura integral ou aprovação) e não valida chaves bibliográficas nem audita capítulos. O score anterior lido do state compartilhado é exibido como valor registrado, com origem não estabelecida; o score heurístico calculado na execução atual é explicitado com seu escopo. Somente números finitos são apresentados como score: ausência aparece como `—` e qualquer outro valor do state é declarado inválido ou indisponível, sem ecoar conteúdo, inclusive nos circuit breakers. Atingir o alvo apenas registra o limiar heurístico (`loop-heuristic-threshold`); oscilação/estagnação interrompem o processo com status `failed`, sem rollback ou restauro. Abaixo do alvo cria um snapshot `kind: "marker"` (marco de processo, sem conteúdo restituível, não é ponto de recuperação) e um relatório com as limitações; não executa correções/restauração/compilação autonomamente nem é um segundo harness. |

O **auditor é read-only quanto ao manuscrito**; persistir findings/contexto acadêmico não autoriza corrigir o texto. O corretor exige autorização humana específica, com alterações delimitadas. Essa é a fronteira normativa: o enforcement nativo DSH é proposto na PR #1, não comprovado na master. Markdown não substitui controle de acesso; identidade ausente ou não verificada não concede permissão mutante.

`skipSnapshot`, `force`, `confirm` ou uma escolha de UI **não são autorização implícita** para mutação, destruição ou mudança de rubrica. Snapshot só deve ser declarado restaurável após prova de reversibilidade correspondente. Revise diff, arquivos protegidos e resultados; não trate um índice estável como integridade demonstrada.

### Referências, similaridade, IA e compilação

| Operação e fonte | Comportamento no código e pré-requisitos |
|---|---|
| [banca_refs](../src/tools/banca_refs.ts) | Lê o BibTeX configurado e o interpreta com o parser local determinístico tudo-ou-nada (ver [gramática suportada e limitações](bibtex-parser-grammar.md)); reutiliza `.banca/cache/refs.json` por chave exata e por DOI (case-insensitive). Sem resultado positivo no cache, a referência é marcada `bloqueada` com `external_transport_blocked` e provider `none`: não há `fetch`, não se inicia `McpClient` nem subprocesso e não há fallback REST. Bloqueadas ficam fora da média (`N/A` se todas) e não contam como `nao_encontrada`; erro de parsing retorna `bib parse error:` sem gravar relatório. O resultado é evidência local, não certidão de fonte nem validação externa. |
| [banca_ia](../src/tools/banca_ia.ts) | Triagem heurística não conclusiva. Executa o detector Python (`pt_ai_detector`) somente se ele já estiver instalado no ambiente, validando status, JSON, schema, score e contagens; caso contrário (ou com `forceRegex`, que não inicia subprocesso Python) usa a regex existente. Consolida entradas de caminho que resolvem para a mesma fonte canônica (por exemplo `main.tex` apontando para um capítulo), preservando os caminhos relativos configurados/aliases, e informa entradas descobertas, fontes canônicas distintas, aliases e fontes analisadas. Retorna e persiste em `.banca/reports/ia-*.md` o método efetivo por fonte, motivo de seleção/fallback, elegíveis/analisados/omitidos (limite de 50 parágrafos Python por fonte), truncamento e limitações. Não há confiança calibrada; agregados por método não são comparáveis entre si. Resultado **não comprova autoria**, não constitui nota/parecer/penalidade e não substitui a auditoria integral do manuscrito. |
| [banca_plagio](../src/tools/banca_plagio.ts) | Interpreta relatório CopySpider existente (`reportPath` dentro de `projectRoot`); PDF depende de `pdftotext`. Classificações ENTREVISTAR/REESCREVER/PULAR são triagem de similaridade, não veredito de plágio nem autorização para reescrever. |
| [banca_compile](../src/tools/banca_compile.ts) | Usa configuração de compilação habilitada, engines LaTeX/BibTeX permitidas e instaladas e arquivos válidos. Inicia processos externos; compilação real não foi validada de ponta a ponta no DSH nesta base. PDF compilado não prova conformidade ou mérito acadêmico. |

As **8 skills empacotadas** são: `banca-avaliacao`, `banca-correcao`, `banca-detector-ia`, `banca-grille`, `banca-plagio`, `banca-planejador`, `banca-referencias` e `banca-revisor`. São instruções acadêmicas em [skills](../skills/), não oito fluxos DSH demonstrados. A entrevista da grille não comprova implementação de decisões por opções (issue #4).

#### Como interpretar `banca_refs`

A ferramenta combina o [parser BibTeX local](bibtex-parser-grammar.md) com o cache local `.banca/cache/refs.json`; a validação externa não está disponível nesta base DSH-only. Distinga os cenários:

| Cenário | Significado |
|---|---|
| Resultado positivo cacheado | Evidência armazenada reutilizada (provider `cache`) |
| Cache sem resultado positivo | Referência `bloqueada` para validação externa (provider `none`, `external_transport_blocked`) |
| Cache parcial | Avaliação parcial: só as referências com cache positivo entram na média |
| Todas bloqueadas | Nenhuma referência avaliada; média `N/A` |
| Parsing inválido | Falha explícita de interpretação (`bib parse error:`), sem relatório |
| Arquivo válido sem entradas | Nenhuma entrada encontrada (`no entries found in bib file`) |

- `bloqueada` **não** significa `nao_encontrada`: o cache não produziu resultado positivo e o DSH observado (`0.2.0-rc.2`) não fornece provedor nativo de referências; a referência permanece pendente de validação, não é prova de referência falsa.
- Bloqueios não entram na média nem no denominador de avaliadas; a média é `N/A` quando todas as referências estão bloqueadas e o resultado é parcial nos casos mistos (veredito de avaliação parcial).
- Sintaxe BibTeX válida não comprova existência, atualidade ou autenticidade da publicação.
- Cache positivo não comprova consulta externa atual: é evidência armazenada, não certidão de fonte.
- O relatório `.banca/reports/refs-<timestamp>.md` registra total, avaliadas/total, média (ou `N/A`), verificadas, não encontradas, bloqueadas, providers usados (por exemplo `cache: 1 refs`, `none: 1 refs`), tabela de resultados, veredito e aviso de bloqueio: é registro de evidências e limitações, não certificado de validação externa.
- A ferramenta não substitui avaliação humana de qualidade, pertinência ou autenticidade; erro de parsing não grava relatório de validação.

## 3. Interpretar resultados sem substituir a banca

- Rubricas, índices de citação, notas/metas internas e heurísticas auxiliam revisão; **não equivalem à avaliação oficial**, nota, aprovação ou reprovação de banca. ABNT, citações, conteúdo e estilo são dimensões de revisão, não um resultado acadêmico automático de `banca_auditar`.
- Exemplo apenas interpretativo: se há lotes pendentes ou diagnóstico `partial`/`blocked`, o resultado é **análise incompleta, sem parecer integral**; não se emite nota conclusiva. Mesmo uma entrada de síntese válida não é avaliação institucional.
- Não invente referências, DOI, citações, findings, linhas ou evidências. Bloqueio externo de referência, correspondência parcial ou ausência de confirmação devem permanecer explicitamente não verificadas; no fluxo DSH-only de `banca_refs` não há tentativa de rede nem de MCP próprio, e uma referência bloqueada não prova que ela seja falsa.
- Detector de IA e similaridade são sinais metodológicos sujeitos a revisão humana. Não inferir autoria, fraude ou mérito a partir deles.
- Este guia não altera rubricas, critérios institucionais, scoring ou regras acadêmicas. Decisões e mudanças nessas áreas exigem autorização humana registrada.

## Dificuldades comuns e resposta segura

| Situação | O que conferir sem contornar proteções |
|---|---|
| Arquivo principal ou bibliografia ausente | Conferir caminhos configurados e arquivos autorizados; resolver diagnósticos antes de avançar cobertura. |
| Plano bloqueado, leitura incompleta ou fingerprint divergente | Interromper, preservar evidência e resolver a causa. Não fabricar findings nem marcar lotes como analisados para liberar síntese. |
| Arquivo imutável ou caminho protegido | Preservar o bloqueio e pedir decisão ao responsável; não remover proteção para concluir a correção. |
| Configuração já existente | Inspecionar e preservar o estado; não sobrescrever automaticamente com `force`. |
| Referência não verificada ou provedor indisponível | Conferir se o estado é `bloqueada` (cache sem resultado positivo e ausência de provedor nativo DSH) ou `nao_encontrada` (resultado de validação existente): são estados distintos. Bloqueadas ficam fora da média e podem deixá-la `N/A` ou parcial; não são prova de referência falsa. Registrar a limitação e manter a referência pendente; não configurar outro harness, não instalar nem iniciar MCP próprio, não ativar campos legados (`crossrefAcademicEnabled`, `OPENBANCA_ENABLE_CROSSREF_MCP`) e não inventar DOI. |
| Engine LaTeX indisponível | Registrar compilação não executada; preparo TypeScript não instala TeX nem valida PDF. |
| Tool/skill/agente não aparece no DSH | Não inferir disponibilidade pelos arquivos. Consultar instalação, PR #1 e issue #3; não há procedimento funcional validado neste guia. |

Para prioridades e pendências, consulte o [roadmap](../ROADMAP.md). Revisão humana e E2E autorizado, com SHA identificado, são necessários antes de ampliar alegações de integração.
