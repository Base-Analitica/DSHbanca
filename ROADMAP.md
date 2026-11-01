# Roadmap

Estado de referência: `origin/master` em `3c24a53` (merge da PR #49). Este documento registra prioridades do DSHbanca e **não** promete release, licença, publicação ou cutover — essas decisões competem ao mantenedor. Nenhum item é marcado como concluído por existir documentação, mock ou CI convencional.

Legenda de status:

- `[x]` implementado e comprovado na base de referência por testes determinísticos ou CI;
- `[/]` parcial, com evidência E2E DSH real observada em SHA específico (`aa39d37` na PR #49; `cb066a1` na PR #1), ou com escopo deliberadamente restrito;
- `[ ]` pendente ou não comprovado no host real;
- `(PR #N)` pull request integrada na `master`;
- `(issue #N)` issue relacionada ou dependência aberta.

## Fundação do repositório (concluída)

- [x] Estrutura inicial do repositório
- [x] README, ROADMAP, docs básicas e política de segurança
- [x] Scripts de validação e prompts de revisão por IA
- [x] Templates de issue e de PR
- [x] Guia de contribuição
- [x] CI configurada e executando na `master` (`typecheck`, `build`, `bun test`, `scripts/validate.sh`, `scripts/check-secrets.sh --ci`)

## 1. Governança DSH-only e integração Cordis

- [x] Invariante **DSH é o único harness** em `AGENTS.md` e `docs/architecture.md` (PR #6)
- [x] `package.json` expõe `./dsh`, `./cordis.patch.yml` e `dsh.bundle.patch`
- [x] `cordis.patch.yml` monta o entry `dshbanca/dsh` e o preset `banca-auditor` (PR #1)
- [x] `src/dsh.ts` declara `name`/`inject`, registra 16 ferramentas nativas, guard monotônico read-only e provider de skills (PR #1)
- [x] `src/index.ts` reexporta diretamente a interface DSH-only e decisões acadêmicas; dependência `@opencode-ai/plugin` removida
- [/] Carregamento e composição comprovados em perfil real DSH sem modelo em SHAs específicos autorizados (`cb066a1` na PR #1 e `aa39d37` na PR #49)
- [ ] Migração da nomenclatura legada de governança (`docs/ai-review-protocol.md`, `docs/issue-labeling-policy.md`, `.github/labels.yml`) — dívida fora desta folha
- [x] Reconciliação factual e documental de `README.md`, `ROADMAP.md` e `docs/architecture.md` (issue #51)

## 2. Discovery e execução nativa de tools, skills e agentes

- [x] 16 ferramentas acadêmicas nativas registradas via `ctx.tools.register` (PR #1)
- [x] Guard monotônico read-only do auditor via `ctx.tools.guard` e verificação no executor (PR #1)
- [x] Preset `banca-auditor` registrado via Cordis patch (PR #1)
- [x] 8 skills acadêmicas empacotadas na fonte canônica `skills/` (PR #41, PR #43)
- [x] Provider nativo de skills via `ctx.skills.registerProvider` com discovery e carregamento hermético das 8 skills (PR #39)
- [x] Gate E2E de perfil DSH documentado em `docs/dsh-profile-e2e.md` e implementado em `scripts/e2e-dsh-profile.ts` (PR #1)
- [/] Descoberta, integridade das 8 skills e preset do auditor observados no DSH real no SHA específico `aa39d37` (PR #49)
- [ ] Consumo ativo de instruções Markdown por modelo de IA em sessão aberta interativa (dependente de modelo/UX)

## 3. E2E DSH real no SHA final

- [x] CI convencional verde na `master` (não substitui E2E)
- [/] E2E DSH real sem modelo executado e aprovado em SHAs autorizados (`cb066a1` da PR #1 e `aa39d37` da PR #49 com DSH `0.2.0-rc.2`, Cordis `4.0.4` e loader `1.0.5`); não constitui nova execução automática no commit de merge da master (`3c24a53`)
- [ ] Execução contínua do gate E2E em CI provisionada com publicação automática de relatório sanitizado para o HEAD da master
- [ ] E2E com modelo de IA (somente sob autorização humana específica, com modelo, custo e isolamento declarados)
- [ ] Interface Web real e interativa do DSH comprovada de ponta a ponta (issue #4 permanece aberta com `agent:blocked` e `needs:e2e`)

## 4. Cobertura acadêmica exaustiva, checkpoints e retomada

- [x] Planejamento determinístico de cobertura por lotes canônicos, omissões e fingerprint (`src/lib/analysis_coverage.ts`)
- [x] Checkpoints versionados e retomada (`src/lib/analysis_checkpoint.ts`)
- [x] Findings validados por plano, lote e proveniência; síntese global condicionada à cobertura completa (`src/lib/analysis_findings.ts`, `src/lib/analysis_synthesis.ts`)
- [x] Corpus acadêmico sintético versionado v1 com 10 cenários objetivos para regressão determinística de particionamento e síntese (`tests/fixtures/academic-coverage/v1/`, PR #35)
- [x] Auditoria durável por lote exigida antes do avanço de checkpoint e gate de síntese (PR #45)
- [/] Ciclo integrado de avanço de lotes e gate de síntese validado no E2E DSH real sem modelo no SHA `aa39d37` (PR #49)
- [ ] Validação em corpus acadêmico real de trabalhos complexos de terceiros autorizados

## 5. Correção autorizada, snapshots e decisões acadêmicas

- [x] Guardrails acadêmicos de proteção e validação de caminhos (`src/lib/guards.ts`, `src/lib/safe_paths.ts`)
- [x] Snapshots direcionados e política de restore (`src/tools/banca_snapshot.ts`, `src/tools/banca_restore.ts`)
- [x] Contrato pós-correção e checklist (`src/tools/banca_contract.ts`, `src/tools/banca_checklist.ts`)
- [x] Guard de autorização / read-only no dispatch nativo do DSH (`ctx.tools.guard`) bloqueando mutações para auditor e subagentes (PR #1)
- [x] Contratos nativos de perguntas estruturadas (`ctx.userQuestions`) e aprovação independente (`ctx.approval`) com garantia estrita de não-mutação na seleção de opção (PR #47)
- [x] Primeira decisão acadêmica selecionável nativa em `src/lib/academic_decision.ts` com fundamentação em evidências (PR #49)
- [/] Exercício de `ctx.userQuestions` e `ctx.approval` em E2E DSH real sem modelo no SHA `aa39d37` (PR #49)
- [ ] Fluxo completo de correção autorizada pelo usuário via Web com reauditoria no DSH real
- [ ] Alterações de rubrica, scoring ou nota somente com decisão humana registrada

## 6. LaTeX/BibTeX real, corpus versionado e avaliação humana

- [x] Parser LaTeX, resolução de includes e proveniência por arquivo/linha, com testes unitários
- [x] Utilitários de BibTeX, citações e scoring, com testes unitários
- [x] Corpus acadêmico sintético versionado v1 em `tests/fixtures/academic-coverage/v1/` para contratos objetivos (PR #35)
- [ ] Compilação real de documentos complexos arbitrários (`lualatex`) de ponta a ponta
- [ ] Separação explícita entre validação estrutural, sinal heurístico e avaliação acadêmica humana
- [ ] Avaliação acadêmica humana / institucional soberana (não automatizada)

## 7. Evolução supervisionada e governança

- [ ] Revisões por IA registradas a partir dos prompts existentes em `prompts/`
- [ ] Definição de licença (`LICENSE_PENDING.md` permanece pendente)
- [ ] Remoção ou migração definitiva do legado inativo de outro harness (`assets/opencode/`, script `e2e:opencode`) — tratada como dívida histórica
- [ ] Alinhamento residual da issue #50 (follow-up menor P3 de classificação de cancelamento nulo)
- [ ] Interface Web real e retomada de UX (issue #4)
- [ ] Preparação de release e cutover — **decisão exclusiva do mantenedor; não autorizada por este roadmap**

## Marcos

| Marco | Descrição | Status |
|-------|-----------|--------|
| Protótipo experimental | Base acadêmica em `0.1.0`, `private`, `UNLICENSED`, com CI convencional | Concluído na `master` |
| Integração nativa DSH | 16 tools, guard read-only e preset Cordis registrados via Cordis no host | Integrado na `master` (PR #1) |
| Descoberta de skills | 8 skills canônicas registradas via provider nativo | Integrado na `master` (PR #39, PR #41, PR #43) |
| Corpus sintético e auditoria durável | Regressão determinística e avanço condicionado a evidência | Integrado na `master` (PR #35, PR #45) |
| Perguntas nativas e decisão acadêmica | Perguntas estruturadas, aprovação independente e decisão selecionável | Integrado na `master` (PR #47, PR #49) |
| E2E DSH real sem modelo | Execução nativa comprovada em perfil real nos SHAs `cb066a1` e `aa39d37` | Observado em SHAs específicos; pendente automação contínua |
| Interface Web e retomada interativa | Renderização de cards nativos e reconciliação em sessões desconectadas | Pendente (issue #4) |
| Release e cutover | Licença e publicação definidas pelo mantenedor | Não autorizado |

## Métricas de sucesso

- [x] CI executando na `master`
- [x] Corpus acadêmico sintético versionado coberto por testes determinísticos (PR #35)
- [/] E2E DSH real validado em perfil real nos SHAs autorizados (`cb066a1`, `aa39d37`); automação contínua em CI provisionada pendente
- [x] Nenhum segredo ou manuscrito real exposto em repositório, issue, commit ou PR
- [ ] Interface Web interativa e fluxo de sessão reconectada comprovados (issue #4)
- [ ] Licença definida e release aprovado pelo mantenedor
