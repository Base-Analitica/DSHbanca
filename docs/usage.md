# Guia de uso e estado operacional do DSHbanca

## Visão geral e limites

O **DSHbanca** é uma camada acadêmica experimental para o **DSH (DeepSeek Harness)**, seu único harness, com integração declarada via **Cordis**. O DSH é responsável por runtime, modelos e autenticação, sessões, identidade/lifecycle de agentes, dispatch, permissões, plugins, skills e configuração do ambiente. O DSHbanca cuida de manuscrito, cobertura por lotes, checkpoints, rubricas, findings com proveniência, validações, snapshots e guardrails acadêmicos.

Essa divisão é normativa, não prova de funcionamento. Consulte o [README](../README.md), a [governança](../AGENTS.md), a [arquitetura](architecture.md) e o [protocolo de revisão](ai-review-protocol.md). OpenBanca/OpenCode pertence a outro projeto; referências a esse harness no código são **legado não suportado**, não compatibilidade dual nem fallback operacional do DSHbanca.

## O que está disponível e o que falta provar

Referência desta revisão: `origin/master` em `66049be57123ddd5ff7d0dec3c3cba2d5db36f4f`. Estados de PRs e issues abaixo são os consultados em 22/10/2026; revalide-os antes de usar uma revisão posterior.

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
| [banca_corrigir](../src/tools/banca_corrigir.ts) | Recebe `corrections` com `file`, `oldText`, `newText`; verifica caminhos, `immutableFacts`, `protectedPaths` e caminhos permitidos. Substitui todas as ocorrências; `expectedOccurrences` divergente emite aviso, mas não impede a substituição. Cria cópias prévias salvo `skipSnapshot`; eventual regressão de índice é aviso/estado de falha, **não rollback automático**. |
| [banca_snapshot](../src/tools/banca_snapshot.ts) | Copia arquivos do manuscrito resolvidos pela configuração e registra snapshot no estado. Não é backup integral do projeto nem prova de reversibilidade. |
| [banca_restore](../src/tools/banca_restore.ts) | Sem `snapshotId`, lista snapshots; com ID e sem `confirm`, apresenta dry-run. Com `confirm: true`, cria backup prévio e substitui arquivos selecionados conforme a configuração. Exige inspeção e autorização específica; dry-run/backup não garantem restauração íntegra. |
| [banca_contract](../src/tools/banca_contract.ts) | Resume correções declaradas e indicadores de proteção/estado; pode salvar relatório com `save`. Não substitui revisão do diff nem prova de aplicação correta. |
| [banca_loop](../src/tools/banca_loop.ts) | Etapa preparatória/assistida sobre densidade de citações, com estado/relatório e detecção de estagnação/oscilação. No ramo de snapshot cria diretório e registro, sem copiar o manuscrito. Não executa correções/compilação autonomamente nem é um segundo harness. |

O **auditor é read-only quanto ao manuscrito**; persistir findings/contexto acadêmico não autoriza corrigir o texto. O corretor exige autorização humana específica, com alterações delimitadas. Essa é a fronteira normativa: o enforcement nativo DSH é proposto na PR #1, não comprovado na master. Markdown não substitui controle de acesso; identidade ausente ou não verificada não concede permissão mutante.

`skipSnapshot`, `force`, `confirm` ou uma escolha de UI **não são autorização implícita** para mutação, destruição ou mudança de rubrica. Snapshot só deve ser declarado restaurável após prova de reversibilidade correspondente. Revise diff, arquivos protegidos e resultados; não trate um índice estável como integridade demonstrada.

### Referências, similaridade, IA e compilação

| Operação e fonte | Comportamento no código e pré-requisitos |
|---|---|
| [banca_refs](../src/tools/banca_refs.ts) | Lê BibTeX e usa cadeia MCP → REST → cache, registrando provedor/evidência no relatório. É implementação existente, **não integração MCP DSH validada**. Pode acessar rede/processos; não é orientação para configurar MCP externo. Lifecycle, autenticação e integrações gerais pertencem ao host. |
| [banca_ia](../src/tools/banca_ia.ts) | Triagem heurística; pode tentar Python quando disponível ou usar regex. `forceRegex` evita a tentativa Python. Resultado de risco/confiança **não comprova autoria** nem justifica reprovação. |
| [banca_plagio](../src/tools/banca_plagio.ts) | Interpreta relatório CopySpider existente (`reportPath` dentro de `projectRoot`); PDF depende de `pdftotext`. Classificações ENTREVISTAR/REESCREVER/PULAR são triagem de similaridade, não veredito de plágio nem autorização para reescrever. |
| [banca_compile](../src/tools/banca_compile.ts) | Usa configuração de compilação habilitada, engines LaTeX/BibTeX permitidas e instaladas e arquivos válidos. Inicia processos externos; compilação real não foi validada de ponta a ponta no DSH nesta base. PDF compilado não prova conformidade ou mérito acadêmico. |

As **8 skills empacotadas** são: `banca-avaliacao`, `banca-correcao`, `banca-detector-ia`, `banca-grille`, `banca-plagio`, `banca-planejador`, `banca-referencias` e `banca-revisor`. São instruções acadêmicas em [skills](../skills/), não oito fluxos DSH demonstrados. A entrevista da grille não comprova implementação de decisões por opções (issue #4).

## 3. Interpretar resultados sem substituir a banca

- Rubricas, índices de citação, notas/metas internas e heurísticas auxiliam revisão; **não equivalem à avaliação oficial**, nota, aprovação ou reprovação de banca. ABNT, citações, conteúdo e estilo são dimensões de revisão, não um resultado acadêmico automático de `banca_auditar`.
- Exemplo apenas interpretativo: se há lotes pendentes ou diagnóstico `partial`/`blocked`, o resultado é **análise incompleta, sem parecer integral**; não se emite nota conclusiva. Mesmo uma entrada de síntese válida não é avaliação institucional.
- Não invente referências, DOI, citações, findings, linhas ou evidências. Falha de rede, correspondência parcial ou ausência de confirmação devem permanecer explicitamente não verificadas.
- Detector de IA e similaridade são sinais metodológicos sujeitos a revisão humana. Não inferir autoria, fraude ou mérito a partir deles.
- Este guia não altera rubricas, critérios institucionais, scoring ou regras acadêmicas. Decisões e mudanças nessas áreas exigem autorização humana registrada.

## Dificuldades comuns e resposta segura

| Situação | O que conferir sem contornar proteções |
|---|---|
| Arquivo principal ou bibliografia ausente | Conferir caminhos configurados e arquivos autorizados; resolver diagnósticos antes de avançar cobertura. |
| Plano bloqueado, leitura incompleta ou fingerprint divergente | Interromper, preservar evidência e resolver a causa. Não fabricar findings nem marcar lotes como analisados para liberar síntese. |
| Arquivo imutável ou caminho protegido | Preservar o bloqueio e pedir decisão ao responsável; não remover proteção para concluir a correção. |
| Configuração já existente | Inspecionar e preservar o estado; não sobrescrever automaticamente com `force`. |
| Referência não verificada ou provedor indisponível | Registrar a limitação e manter a referência pendente. Não configurar outro harness nem inventar DOI. |
| Engine LaTeX indisponível | Registrar compilação não executada; preparo TypeScript não instala TeX nem valida PDF. |
| Tool/skill/agente não aparece no DSH | Não inferir disponibilidade pelos arquivos. Consultar instalação, PR #1 e issue #3; não há procedimento funcional validado neste guia. |

Para prioridades e pendências, consulte o [roadmap](../ROADMAP.md). Revisão humana e E2E autorizado, com SHA identificado, são necessários antes de ampliar alegações de integração.
