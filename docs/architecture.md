# Arquitetura do DSHbanca

## Escopo e autoridade arquitetural

**DSHbanca é um plugin acadêmico exclusivamente para DeepSeek Harness (DSH).** DSH é o único harness e Cordis é o mecanismo de composição do plugin com o host. OpenBanca é um projeto separado e não define o runtime deste repositório.

Esta página distingue a base `origin/master` avaliada para issue #5, SHA `be4453a9d2b4b42a8c53567e32d8bc39def92d89`, do desenvolvimento ainda não incorporado na PR #1, branch `fix/dsh-native-tools`, cujo HEAD consultado é `7a77941dd3c1db56cd3b41e708a9ebebba6c89df`. A PR #1 permanece draft e com `CHANGES_REQUESTED`. Código ou resultado observado nela não deve ser descrito como presente na base nem como prova de outro SHA.

## Divisão de responsabilidades

| Componente | Responsabilidade |
|---|---|
| **DSH** | Harness e runtime; modelos e autenticação; sessões e identidade/lifecycle de agentes; dispatch de ferramentas; permissões; plugins e lifecycle Cordis; discovery e carregamento de skills e instruções; configuração do ambiente. |
| **DSHbanca** | Regras e dados acadêmicos; ingestão e cobertura do manuscrito; checkpoints; rubricas; findings, proveniência e fingerprints; validações determinísticas; proteções acadêmicas; snapshots, changesets e ferramentas de domínio. |

A separação é normativa. Ela não significa que a base já forneça uma integração DSH completa. Não implemente no plugin runtime geral, loop de agente, controlador de sessão, permission engine, roteador de modelos, autenticação de provedor ou lifecycle paralelo. Antes de nova infraestrutura, verifique o contrato DSH instalado e documente uma lacuna reproduzida. Sem lacuna, use o host; se o contrato não puder ser provado, marque `BLOCKED`.

```text
┌──────────────────────────────────────────────────────────┐
│ DSH / Cordis                                              │
│ runtime, sessões, identidade, dispatch, permissões,       │
│ plugins, skills e provedores                              │
└──────────────────────────────┬───────────────────────────┘
                               │ APIs nativas Cordis/DSH
┌──────────────────────────────▼───────────────────────────┐
│ DSHbanca                                                  │
│ ingestão, cobertura, checkpoints, findings, rubricas,     │
│ estado acadêmico, snapshots e guardrails                  │
└──────────────────────────────────────────────────────────┘
```

## Estado comprovado por base e por PR

| Capacidade | `origin/master` `be4453a` | PR #1 draft, HEAD `7a77941` |
|---|---|---|
| Empacotamento Cordis | `package.json` tem export `./dsh` e patch do bundle. `cordis.patch.yml` aponta para `dshbanca/dsh`. Isso declara um entrypoint, mas não comprova que o host o carregou. | O patch permanece e o E2E da PR exercita instalação/composição em perfil DSH real nos SHAs relatados. |
| Entry points | `src/dsh.ts` declara `name = "dshbanca"`, injeta `skills` e registra um provider de skills quando `ctx.skills.registerProvider` existe. `src/index.ts` continua como plugin baseado em `@opencode-ai/plugin`, exportado como entrypoint principal. | `src/dsh.ts` foi ampliado para registrar tools acadêmicas com `ctx.tools.register`, guard com `ctx.tools.guard` e provider de skills. O entrypoint e o pacote também foram atualizados na PR. Esses registradores não estão na base consultada. |
| Tools e enforcement | Não há registro de tools acadêmicas nem guard DSH em `src/dsh.ts` nesta base. Os módulos em `src/tools/` usam a interface `@opencode-ai/plugin`, portanto sua presença não comprova dispatch DSH. | A implementação DSH nativa e o gate real de identidade/read-only pertencem à PR draft. A prova issue #2 foi reportada como `PASS` no SHA publicado `8da375c35e54eb985b5d227eb8865ca779a4bc79`, com DSH `0.2.0-rc.2`, Cordis `4.0.4` e loader `1.0.5`. Isso vale para o SHA executado e o perfil observado, não para todo HEAD posterior. |
| Gate de integração | `package.json` contém `e2e:opencode`; não contém `e2e:dsh:profile`. A base não contém `docs/dsh-profile-e2e.md`. | A PR documenta e amplia o gate `e2e:dsh:profile`. O relatório de issue #2 registra execução nativa real naquele SHA, sem modelo, incluindo identidade de Agent, guard pré-corpo, ferramenta permitida, integridade e teardown. |
| Markdown de `banca-auditor` | O asset existe, mas nenhum registro de Agent/preset ou projeção do conteúdo foi comprovado nesta base. | Issue #3 continua bloqueada para provar consumo do Markdown pelo Agent. Instalação, hash igual, preset vazio ou E2E de identity/read-only não comprovam essa etapa. |
| Loop, prompts e parecer acadêmico | Não comprovados como fluxo DSH. | Também não comprovados pela prova sem modelo da issue #2. Não há afirmação de `Agent.send`, `session.prompt`, inferência ou qualidade de julgamento. |

A evidência E2E da issue #2 foi publicada para o SHA `8da375c...`, não para a base `be4453a` nem como prova automática do HEAD atual `7a77941`. A PR #1 contém comentários, relatórios e histórico por SHA. Consulte a [PR #1](https://github.com/Base-Analitica/DSHbanca/pull/1) e associe cada resultado ao commit efetivamente testado. As versões citadas são as observadas naquela execução, não uma faixa suportada ou garantia de uma instalação futura.

## Camada acadêmica presente no código

Os seguintes módulos acadêmicos existem na base. A descrição indica o escopo de código observado, não que todos estejam descobertos ou executáveis pelo DSH:

| Módulo | Responsabilidade observada no código | Limite da evidência |
|---|---|---|
| `src/lib/latex_loader.ts`, `latex_parser.ts`, `latex_include_resolver.ts`, `paths.ts` | Carregamento ordenado do manuscrito LaTeX, includes, proveniência por arquivo/linha, fingerprint e diagnósticos de leitura/path. | Unit tests e código não provam que toda instalação ou fluxo do host use o loader. |
| `src/lib/analysis_coverage.ts` | Planejamento determinístico de chunks/lotes com status de cobertura, omissões e fingerprint; inclui estratégia exaustiva e pode bloquear planos incompletos. | Não executa modelo nem substitui dispatch do host. |
| `src/lib/analysis_checkpoint.ts`, `analysis_findings.ts`, `analysis_synthesis.ts` | Checkpoints versionados e reanudáveis; findings validados por plano, fingerprint, lote e proveniência; entrada de síntese sujeita a cobertura completa. | São contratos de domínio, não um agent loop ou parecer final. |
| `src/lib/state.ts`, `safe_paths.ts`, `guards.ts` | Persistência sob `.banca/`, validação de caminhos e mecanismos acadêmicos de proteção/estado. | Não confundir guards internos de arquivos com o guard de autorização de ferramentas do DSH. |
| `src/lib/score.ts`, `bibtex.ts`, `citation.ts`, `latex.ts`, `reports.ts` | Regras e utilidades acadêmicas, referências, scoring e relatórios. | Não declarar decisão institucional nem validação acadêmica completa a partir da existência desses módulos. |
| `src/tools/` | Módulos acadêmicos como `banca_context`, `banca_auditar`, `banca_corrigir`, `banca_snapshot`, `banca_restore` e outros. Na base, esses adapters usam `@opencode-ai/plugin`. | Seu uso por uma integração DSH requer adaptação nativa e prova no host. A integração de tools da PR #1 ainda está em draft. |

A arquitetura acadêmica deve preservar cobertura do manuscrito, proveniência, checkpoints, rubricas, findings, fingerprints, integridade dos snapshots e guardrails. Não altere protocolo por lotes, scoring, rubricas ou semântica de restore para facilitar integração. Detecção de IA, plágio e similaridade são sinais metodológicos, não vereditos absolutos.

## Discovery, identidade e autoridade

A prova de um asset/agente é uma cadeia: fonte canônica → empacotamento/instalação → discovery pelo host → composição/associação ao Agent → conteúdo projetado no contexto correto → dispatch/comportamento exigido. Cada etapa requer evidência própria.

- Arquivo em `assets/dsh/agents/` não prova discovery nem associação ao Agent.
- Nome de preset não prova ingestão de instruções Markdown.
- E2E sem modelo pode comprovar somente as etapas que observou diretamente no DSH.
- Texto de instrução não é controle de acesso. O auditor deve continuar read-only por enforcement técnico no host/guard. Identidade ausente ou não verificada não concede permissão mutante.
- Não eleve Markdown a system persona ou nível superior de autoridade sem decisão humana. Alterar trust model, identidade, permissões ou separação auditor/corretor exige aprovação registrada.

## Matriz da correção documental

| Regra anterior | Evidência examinada | Direção corrigida |
|---|---|---|
| Harness do projeto e suas APIs podem ser herdados de outro repositório | Issue #5 estabelece DSH-only; `cordis.patch.yml` e `src/dsh.ts` mostram o entrypoint DSH na base | DSH é o único harness. Regras de outro projeto não definem a arquitetura. |
| Existência de export Cordis significa integração completa | Em `master`, `src/dsh.ts` registra somente provider de skills; tools/guard nativos aparecem na PR draft | Distinguir declaração/skill provider em `master` da integração de tools/guard ainda em revisão na PR #1. |
| E2E de outro host comprova DSH | Script padrão em `master` é `e2e:opencode`; E2E DSH está na PR #1 e o resultado é específico de SHA | Alegações de integração DSH exigem execução DSH real no SHA informado. CI convencional não substitui esse gate. |
| Assets e nomes de agentes comprovam carregamento | Issue #3 permanece bloqueada para consumo das instruções Markdown | Exigir discovery, associação e projeção observadas no host, sem inferir a partir de arquivos ou presets vazios. |
| Existência de lógica acadêmica comprova workflow completo | Código modular e testes locais não equivalem a execução integrada no DSH | Descrever cada capacidade com seu nível de evidência e limites. |

## Dívida legada e escopo de migração

Esta issue atualiza somente `AGENTS.md`, `docs/architecture.md` e `docs/terminal-agent-workflow.md`. O restante requer triagem e issues separadas. Menções abaixo são inventário de dívida, não instrução ativa para desenvolver compatibilidade dupla.

| Local | Estado observado |
|---|---|
| `README.md` | Declara suporte DSH/OpenCode dual, descreve uso e validação do antigo host e aponta assets/configuração legados. |
| `ROADMAP.md` | Mantém fase de compatibilidade e testes do antigo host como plano do projeto. |
| `docs/ai-review-protocol.md` | Critérios de compatibilidade e evidência ainda citam o antigo host. |
| `docs/issue-labeling-policy.md`, `.github/labels.yml` | A taxonomia usa `area:opencode`, exemplos e descrições herdadas. Os nomes atuais continuam a fonte operacional até migração aprovada; não inventar labels substitutos. |
| `package.json`, `src/index.ts`, `src/tools/`, dependência `@opencode-ai/plugin`, `scripts/e2e-opencode.ts` e testes correspondentes | Código e testes de integração OpenCode continuam na base. Issue #5 não os remove nem comprova migração. |
| PR #1 | Contém trabalho de integração nativa DSH e E2E ainda em revisão. Não é base aprovada nem autorização para afirmar suporte geral. |

Não há nesta issue alteração de código, migração de compatibilidade, decisão de licença, alteração de trust model ou prova do consumo do Markdown. Issues #3 e #4 permanecem independentes.
