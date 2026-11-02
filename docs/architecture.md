# Arquitetura do DSHbanca

## Escopo e autoridade arquitetural

**DSHbanca é um plugin acadêmico exclusivamente para DeepSeek Harness (DSH).** O DSH é o único harness e Cordis é o mecanismo de composição do plugin com o host. OpenBanca é um projeto separado e não define o runtime deste repositório.

Esta documentação reflete a base `origin/master` verificada no commit `3c24a53e837e3661840446e48991faca0ad14434` (merge da [PR #49](https://github.com/Base-Analitica/DSHbanca/pull/49)), incorporando as integrações das PRs #1 (`820910f`), #35 (`5ffedf4`), #39 (`5bfa86d`), #41 (`e80d415`), #43 (`8371ba1`), #45 (`e326de7`), #47 (`9b8d672`) e #49 (`3c24a53`).

## Divisão de responsabilidades

| Componente | Responsabilidade |
|---|---|
| **DSH** | Harness e runtime; modelos e autenticação de provedores; sessões e identidade/lifecycle de agentes; dispatch de ferramentas; permissões; plugins e lifecycle Cordis; discovery e carregamento de skills e instruções; interface Web interativa e slots; configuração do ambiente. |
| **DSHbanca** | Camada acadêmica específica: representação e ingestão de manuscritos LaTeX; cobertura, segmentação e proveniência por lote canônico; checkpoints versionados e estado acadêmico; rubricas, findings estruturados e fingerprints; validações determinísticas e guardrails; snapshots e restauração; decisões acadêmicas selecionáveis; ferramentas acadêmicas nativas consumidas pelo DSH. |

A separação é normativa. O DSHbanca não implementa runtime geral, loop de agente, controlador de sessão, permission engine, roteador de modelos, cliente de autenticação de provedores nem interface Web própria. O ciclo de vida de ferramentas, agentes, sessões e plugins pertence ao DSH e ao Cordis.

```text
┌────────────────────────────────────────────────────────────┐
│ DSH / Cordis                                              │
│ runtime, sessões, identidade, dispatch, permissões,       │
│ plugins, skills, approval e userQuestions                 │
└──────────────────────────────┬─────────────────────────────┘
                               │ APIs nativas Cordis/DSH
┌──────────────────────────────▼─────────────────────────────┐
│ DSHbanca                                                  │
│ ingestão, cobertura, checkpoints, findings, rubricas,     │
│ estado acadêmico, snapshots, guardrails e decisões        │
└────────────────────────────────────────────────────────────┘
```

## Entrypoints e composição Cordis

A integração nativa é montada por meio do Cordis no host DSH:

- **`cordis.patch.yml`**: declara a montagem do bundle (`id: dshbanca`, `name: 'dshbanca/dsh'`) e o preset declarativo do auditor (`id: dshbanca-banca-auditor-preset`, `name: '@deepseek-ai/dsh-agent-preset'`) associado ao plugin `@deepseek-ai/dsh-agent-instructions` para carregar as instruções do auditor (`banca-auditor.md`).
- **`src/dsh.ts`**: entrypoint Cordis nativo com metadados `name = "dshbanca"` e `inject = ["skills", "tools"]`:
  - **Registro de ferramentas acadêmicas**: no método `apply(ctx)`, carrega as 16 definições via `loadBancaTools()`, converte os esquemas Zod dos argumentos para JSON Schema com `z.toJSONSchema` e chama `ctx.tools.register` para cada ferramenta.
  - **Guard monotônico read-only**: registra via `ctx.tools.guard` um guard que examina o preset composto do agente (`liveComposedPreset` e header `agentPreset`) e a origem (`origin: "subagent"`). Bloqueia ferramentas mutantes de workspace (`banca_init`, `banca_corrigir`, `banca_snapshot`, `banca_compile`, `banca_restore`, `banca_loop`) para agentes com prefixo `banca-auditor*`, e ferramentas mutantes de manuscrito (`banca_corrigir`, `banca_restore`) para subagentes sem o prefixo `banca-corretor*`. O guard é deny-only (nunca força autorização) e pré-corpo, sendo também validado no executor antes de rodar o corpo da ferramenta.
  - **Prevenção de Path Traversal**: `resolveWorkspaceRoot` extrai e valida o `cwd` da sessão com `realpathSync`, e `resolveRealInsideRoot` impede que argumentos `projectRoot` apontem para fora do workspace seguro da sessão.
  - **Provider nativo de skills**: quando `ctx.skills.registerProvider` está disponível, registra o provider `dshbanca` com rank 550, listando os diretórios canônicos sob `skills/` e extraindo frontmatter e corpo de cada `SKILL.md`.
- **`src/index.ts`**: entrypoint principal DSH-only do pacote, reexportando `apply`, `name`, `inject` de `./dsh.js`, as funções de carregamento de ferramentas (`loadBancaTools`, `defineBancaTool`) e a biblioteca de decisões acadêmicas (`src/lib/academic_decision.js`). Não referencia `@opencode-ai/plugin` (dependência removida).

## Matriz de rastreabilidade de capacidades (master 3c24a53)

| Capacidade | Implementação correspondente | PR / Commit integrado | Nível de evidência | Evidência disponível | Limitação remanescente |
|---|---|---|---|---|---|
| **Empacotamento Cordis e Entrypoints** | `package.json` (`exports`, `./dsh`), `cordis.patch.yml`, `src/dsh.ts`, `src/index.ts` | PR #1 (`820910f`), PR #41 (`e80d415`), PR #43 (`8371ba1`) | IMPLEMENTADO / TESTADO / E2E DSH REAL (`aa39d37`) | Reexportação DSH-only em `src/index.ts`; build TS e bundle tools gerados; composição validada no E2E DSH real em `aa39d37` (DSH `0.2.0-rc.2`, Cordis `4.0.4`). | Pacote `private: true`, `UNLICENSED`, não publicado em npm; não executado como novo E2E no merge commit `3c24a53`. |
| **Registro e Descoberta de 16 Ferramentas (Despacho E2E Parcial)** | `src/dsh.ts` (`ctx.tools.register`), `src/lib/tools.ts`, `src/tools/*.ts` | PR #1 (`820910f`) | IMPLEMENTADO / TESTADO / E2E DSH REAL (`aa39d37`) | 16 ferramentas acadêmicas registradas via `ctx.tools.register` e descobertas pelo host DSH (`exactToolSet: true`); esquemas Zod validados; despacho no E2E DSH real (`aa39d37`) exercitado para subconjunto de 8 ferramentas (`banca_init`, `banca_snapshot`, `banca_corrigir`, `banca_restore`, `banca_status`, `banca_context`, `banca_auditar`, `banca_sintese`) e `ask_user_question`. | As 8 ferramentas acadêmicas restantes (`banca_refs`, `banca_ia`, `banca_plagio`, `banca_loop`, `banca_compile`, `banca_checklist`, `banca_validate`, `banca_contract`) possuem testes unitários e herméticos locais (`bun test`), mas não foram despachadas individualmente na sonda E2E; despacho não testado com usuário interativo em produção. |
| **Guard Read-Only e Enforcement de Identidade** | `src/dsh.ts` (`ctx.tools.guard`, `guardDenyReason`, `AUDITOR_DENIED_TOOLS`, `MANUSCRIPT_MUTATING_TOOLS`) | PR #1 (`820910f`) | IMPLEMENTADO / TESTADO / E2E DSH REAL (`aa39d37`) | Bloqueio pré-corpo de ferramentas mutantes para preset `banca-auditor*` e subagentes sem `banca-corretor*`; integridade de SHA-256 preservada; validado no E2E DSH real (`aa39d37`). | Identidade depende dos headers e presets fornecidos pelo host; não cobre lifecycle do subagent manager em produção. |
| **Descoberta e Carregamento de 8 Skills** | `src/dsh.ts` (`ctx.skills.registerProvider`), diretório canônico `skills/` | PR #39 (`5bfa86d`), PR #41 (`e80d415`), PR #43 (`8371ba1`) | IMPLEMENTADO / TESTADO / E2E DSH REAL (`aa39d37`) | Provider `dshbanca` registrado via `ctx.skills`; descoberta e carregamento das 8 skills validados contra digests canônicos no E2E DSH real (`aa39d37`). | Comprova apenas descoberta e carregamento no registry do host; não comprova aplicação das instruções por LLM real. |
| **Cobertura Canônica e Corpus Sintético** | `src/lib/analysis_coverage.ts`, `src/lib/latex_loader.ts`, `tests/fixtures/academic-coverage/v1/` | PR #35 (`5ffedf4`) | IMPLEMENTADO / TESTADO | 10 cenários sintéticos objetivos; 13 testes dedicados cobrindo particionamento UTF-16, omissões, fingerprints e matriz de confusão hermética. | Corpus é sintético e determinístico; não substitui testes com manuscritos reais complexos de terceiros. |
| **Auditoria Durável por Lote e Gate de Síntese** | `src/lib/analysis_checkpoint.ts`, `src/lib/analysis_findings.ts`, `src/lib/analysis_synthesis.ts` | PR #45 (`e326de7`) | IMPLEMENTADO / TESTADO / E2E DSH REAL (`aa39d37`) | Avanço de checkpoint exige auditoria confirmada (`missing_batch_audit` em caso omisso); `banca_sintese` bloqueada até cobertura exaustiva (`state === "complete"`); validado no E2E DSH real (`aa39d37`). | Contratos de dados e integridade; não realiza inferência heurística de conteúdo. |
| **Perguntas Estruturadas e Aprovação Nativa** | `scripts/lib/dsh-profile-e2e-contract.ts`, `tests/native_questions_contract.test.ts` | PR #47 (`9b8d672`) | IMPLEMENTADO / TESTADO / E2E DSH REAL (`aa39d37`) | Contratos nativos de `ctx.userQuestions` e `ctx.approval` exercitados; seleção não mutante; bloqueio de subagente (`DELEGATED_CALLER`); cancelamento (`ASK_ABORTED`); 4 pares 1:1 de auditoria em turno aberto no E2E DSH real (`aa39d37`). | Validado em sonda sintética sem modelo; interface Web interativa permanece pendente (issue #4 OPEN). |
| **Decisão Acadêmica Selecionável Nativa** | `src/lib/academic_decision.ts`, exportada em `src/index.ts` | PR #49 (`3c24a53`) | IMPLEMENTADO / TESTADO / E2E DSH REAL (`aa39d37`) | Ciclo acadêmico não-mutante (`mutationAuthorized: false`); perguntas estruturadas com fundamentação e evidência; rejeição fail-closed; validado no E2E DSH real no HEAD `aa39d37`. | E2E real executado no HEAD `aa39d37` da PR #49, não repetido no merge commit `3c24a53`; Web UI e reconexão de sessão pendentes (#4). Follow-up menor em #50. |
| **Interface Web Interativa e Retomada UX** | N/A (serviços do host DSH) | Pendente (issue #4) | NÃO COMPROVADO | Nenhuma interface Web implementada no plugin; o plugin consome serviços nativos do host. | Issue #4 permanece OPEN (`agent:blocked`, `needs:e2e`). |
| **Execução com Modelo de IA Real** | N/A (gerida pelo host sob autorização) | N/A | NÃO COMPROVADO | Nenhuma inferência executada; suíte e E2E operam sem modelo e sem credenciais. | Requer autorização humana explícita, custos e credenciais; não realizada. |
| **Avaliação Acadêmica Humana / Institucional** | N/A | N/A | NÃO COMPROVADO | N/A | Juízo humano soberano; automação fornece apenas sinais metodológicos e contratos determinísticos. |

> [!IMPORTANT]
> O E2E da PR #49 foi realizado e aprovado no HEAD `aa39d371962f8cb1349af19fbc6acba78f4f4a85` em DSH `0.2.0-rc.2`, Cordis `4.0.4` e cordis-plugin-loader `1.0.5`, sem modelos, credenciais ou interface Web. Essa evidência não é apresentada como um novo teste E2E executado no commit de merge da master (`3c24a53`).

## Camada acadêmica presente no código

Os seguintes módulos acadêmicos existem na base `master` (`3c24a53`). A descrição indica o escopo observado no código e os limites de evidência correspondentes:

| Módulo | Responsabilidade observada no código | Limite da evidência |
|---|---|---|
| `src/lib/latex_loader.ts`, `latex_parser.ts`, `latex_include_resolver.ts`, `paths.ts` | Carregamento ordenado do manuscrito LaTeX, resolução de includes, proveniência por arquivo/linha, fingerprint SHA-256 e diagnósticos de leitura/path. | Testes herméticos validam parsers locais; não provam compilação por motores TeX externos em documentos arbitrários de terceiros. |
| `src/lib/analysis_coverage.ts` | Planejamento determinístico de chunks/lotes com status de cobertura, omissões e fingerprint; estratégia exaustiva que bloqueia planos parciais ou inconsistentes. | Validado com 10 cenários no corpus sintético v1; não executa modelos de IA. |
| `src/lib/analysis_checkpoint.ts`, `analysis_findings.ts`, `analysis_synthesis.ts` | Checkpoints versionados e retomáveis; avanço de checkpoint condicionado a auditoria do lote; findings validados por plano, lote e proveniência; síntese global bloqueada até cobertura exaustiva (`complete`). | Contratos de integridade de dados e gates determinísticos; validados no E2E DSH real (`aa39d37`). |
| `src/lib/state.ts`, `safe_paths.ts`, `guards.ts` | Persistência sob `.banca/`, sanitização de caminhos contra path traversal e proteções de escrita. | Guards internos de arquivos e diretórios complementam, mas não substituem, o guard de ferramentas nativo do DSH. |
| `src/lib/score.ts`, `bibtex.ts`, `citation.ts`, `latex.ts`, `reports.ts` | Regras e utilidades acadêmicas, referências, scoring de conformidade e relatórios. | Sinais metodológicos e validações estruturais; não constituem parecer institucional final nem nota. |
| `src/lib/academic_decision.ts` | Formulação de perguntas estruturadas acadêmicas com evidências e fundamentação; mapeamento fail-closed de intenções; garantia estrita de não-mutação (`mutationAuthorized: false`). | Contrato exercitado no E2E DSH real (`aa39d37`); não constitui interface Web interativa. |
| `src/tools/` | 16 módulos de ferramentas acadêmicas (`banca_init`, `banca_status`, `banca_context`, `banca_auditar`, `banca_sintese`, `banca_corrigir`, `banca_refs`, `banca_ia`, `banca_plagio`, `banca_loop`, `banca_snapshot`, `banca_restore`, `banca_compile`, `banca_checklist`, `banca_validate`, `banca_contract`). | Registradas nativamente no host via `ctx.tools.register` em `src/dsh.ts` e descobertas pelo DSH (`exactToolSet: true`). Despacho exercitado na sonda E2E (`aa39d37`) para o subconjunto de 8 ferramentas acadêmicas (`banca_init`, `banca_snapshot`, `banca_corrigir`, `banca_restore`, `banca_status`, `banca_context`, `banca_auditar`, `banca_sintese`) e `ask_user_question`; as 8 ferramentas restantes são cobertas por testes unitários e herméticos locais (`bun test`), sem despacho individual na sonda E2E. |

## Níveis de validação e distinção do corpus sintético

Para manter a integridade metodológica, a arquitetura distingue rigorosamente os níveis de teste e evidência:
- **Corpus sintético (`tests/fixtures/academic-coverage/v1/`)**: validação mecânica e determinística de contratos de particionamento, contagem UTF-16, invariância de checkpoints, gates de síntese e proveniência de findings. Não utiliza trabalhos reais nem dados sensíveis.
- **Testes unitários (`bun test`)**: exercitam contratos isolados de funções e tipos TypeScript em runtime local (1103 testes pass).
- **LaTeX real**: compilação por motores TeX (`lualatex`), que valida apenas a tipografia e integridade estrutural do documento TeX.
- **DSH real sem modelo**: valida integração de host (Cordis, descoberta das 16 ferramentas e 8 skills, dispatch do subconjunto de ferramentas acadêmicas exercitadas, permissões/guards, perguntas estruturadas e aprovação) observada no ambiente real no SHA autorizado (`aa39d37`).
- **Modelo de IA**: inferência probabilística sob custo e prompt controlado; requer autorização explícita e não foi executada nesta base.
- **Avaliação humana**: juízo institucional soberano sobre qualidade acadêmica e mérito científico, que nenhuma automação ou corpus substitui.

## Discovery, identidade e autoridade

A prova de um asset, ferramenta ou agente é uma cadeia: fonte canônica → empacotamento/instalação → discovery pelo host → composição/associação ao Agent → conteúdo projetado no contexto correto → dispatch/comportamento exigido. Cada etapa requer evidência própria.

- Arquivo em `assets/dsh/agents/` ou `skills/` não prova discovery nem associação ao Agent sem validação no host.
- Nome de preset não prova ingestão de instruções Markdown.
- O registro ou discovery de ferramentas no catálogo do host não equivale ao seu despacho em tempo de execução: o E2E DSH real comprova a descoberta das 16 ferramentas, mas exercita o despacho efetivo de um subconjunto de 8 ferramentas acadêmicas.
- O auditor permanece read-only por enforcement técnico no guard DSH (`ctx.tools.guard`). Identidade ausente ou não verificada não concede permissão mutante.
- Instruções Markdown orientam o comportamento do agente, mas não constituem controle de acesso nem autoridade superior ao guard nativo.
- **Invariante de autoridade**: responder ou selecionar uma alternativa estruturada em `ctx.userQuestions` **nunca** concede autorização de mutação (`allowed-once`) e não emite eventos de aprovação. Mutações de manuscrito exigem fluxo independente e explícito via `ctx.approval`, vinculado ao changeset e escopo específicos.

## Dívida legada e escopo de migração

| Local | Estado observado |
|---|---|
| `README.md`, `ROADMAP.md`, `docs/architecture.md` | Reconciliados na issue #51 com o estado factual da master (`3c24a53`), PRs integradas e limites reais. |
| `package.json` | Removida a dependência legada `@opencode-ai/plugin`. Conserva o script inativo `e2e:opencode` como dívida histórica. |
| `src/index.ts` | Reexporta diretamente `src/dsh.ts`, utilitários de ferramentas e decisões acadêmicas (DSH-only). |
| `assets/opencode/` | Preservado como histórico inativo de migração de outro harness; não faz parte do fluxo operacional do DSHbanca. |
| `docs/ai-review-protocol.md`, `docs/issue-labeling-policy.md`, `.github/labels.yml` | Taxonomia e documentação conservam nomenclaturas legadas; catalogadas para tratamento documental próprio. |
| Issue #4 (`agent:blocked`, `needs:e2e`) | Permanece aberta para comprovação da interface Web real e retomada de UX em sessões desconectadas. |
| Issue #23 | Permanece aberta para consolidação canônica de skills em assets. |
| Issue #50 (`agent:blocked`, `needs:e2e`, P3) | Follow-up menor pós-PR #49 para alinhar `phase: "unknown"` em entradas nulas de cancelamento no classificador do observer. |

Não há alteração de código, dependências, rubricas, trust model ou permissões nesta atualização documental.
