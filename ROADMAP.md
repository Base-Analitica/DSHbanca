# Roadmap

Estado de referência: `origin/master` em `2302a75`. Este documento registra prioridades do DSHbanca e **não** promete release, licença, publicação ou cutover — essas decisões competem ao mantenedor. Nenhum item é marcado como concluído por existir documentação, mock, implementação em PR draft ou CI convencional.

Legenda de status:

- `[x]` comprovado na base de referência;
- `[/]` parcial ou com evidência limitada;
- `[ ]` pendente;
- `(PR #1)` proposto na PR #1 (`fix/dsh-native-tools`), draft e com `CHANGES_REQUESTED`; **não incorporado à `master`**;
- `(issue #N)` depende de outra issue.

## Fundação do repositório (concluída)

- [x] Estrutura inicial do repositório
- [x] README, ROADMAP, docs básicas e política de segurança
- [x] Scripts de validação e prompts de revisão por IA
- [x] Templates de issue e de PR
- [x] Guia de contribuição
- [x] CI configurada e executando na `master` (`typecheck`, `build`, `bun test`, `scripts/validate.sh`, `scripts/check-secrets.sh --ci`)

## 1. Governança DSH-only e integração Cordis

- [x] Invariante **DSH é o único harness** em `AGENTS.md` e `docs/architecture.md` (PR #6, `2302a75`)
- [x] `package.json` expõe `./dsh` e `dsh.bundle.patch`
- [x] `cordis.patch.yml` monta o entry `dshbanca/dsh`
- [x] `src/dsh.ts` declara `name`/`inject` e registra provider de skills
- [ ] Carregamento do bundle comprovado no DSH real no SHA final
- [ ] Migração da nomenclatura legada de governança (`docs/ai-review-protocol.md`, `docs/issue-labeling-policy.md`, `.github/labels.yml`) — dívida fora desta folha
- [x] Correção documental de `README.md` e `ROADMAP.md` (issue #7)

## 2. Discovery e execução nativa de tools, skills e agentes

- [x] 8 skills acadêmicas empacotadas em `skills/`
- [x] 16 módulos de ferramentas em `src/tools/`, registrados no entry principal do pacote
- [/] Gate E2E de perfil DSH documentado apenas na PR #1
- [ ] (PR #1) registro nativo de tools via `ctx.tools` e guard read-only do auditor
- [ ] (PR #1) preset do auditor e associação ao Agent
- [ ] Evidência de discovery/associação de skills e agentes observado no DSH real
- [ ] Consumo das instruções Markdown do `banca-auditor` pelo Agent (issue #3 — bloqueada)

## 3. E2E DSH real no SHA final

- [x] CI convencional verde na `master` (não substitui E2E)
- [/] Evidência E2E sem modelo relatada em SHA anterior da PR #1, com DSH/Cordis observados naquela execução
- [ ] E2E DSH real no SHA final, em checkout limpo, sem modelo, com permissões, identidade e teardown registrados
- [ ] E2E com modelo somente sob autorização humana específica, com modelo, custo e isolamento declarados
- [ ] Publicação de relatório sanitizado por SHA, sem credenciais nem caminhos privados

## 4. Cobertura acadêmica exaustiva, checkpoints e retomada

- [x] Planejamento determinístico de cobertura por lotes canônicos, omissões e fingerprint (`src/lib/analysis_coverage.ts`)
- [x] Checkpoints versionados e retomada (`src/lib/analysis_checkpoint.ts`)
- [x] Findings validados por plano, lote e proveniência; síntese global condicionada à cobertura completa (`src/lib/analysis_findings.ts`, `src/lib/analysis_synthesis.ts`)
- [ ] Execução integrada desses fluxos pelo DSH
- [ ] Validação em corpus real autorizado, com proveniência preservada

## 5. Correção autorizada, snapshots e reauditoria

- [x] Guardrails acadêmicos de proteção e validação de caminhos (`src/lib/guards.ts`, `src/lib/safe_paths.ts`)
- [x] Snapshots direcionados e política de restore (`src/tools/banca_snapshot.ts`, `src/tools/banca_restore.ts`)
- [x] Contrato pós-correção e checklist (`src/tools/banca_contract.ts`, `src/tools/banca_checklist.ts`)
- [ ] Guard de autorização/read-only no dispatch do DSH (PR #1)
- [ ] Fluxo de correção autorizada com reauditoria no DSH real
- [ ] Alterações de rubrica, scoring ou nota somente com decisão humana registrada

## 6. LaTeX/BibTeX real, corpus versionado e avaliação humana

- [x] Parser LaTeX, resolução de includes e proveniência por arquivo/linha, com testes unitários
- [x] Utilitários de BibTeX, citações e scoring, com testes unitários
- [ ] Compilação real de documentos complexos (`lualatex`) de ponta a ponta
- [ ] Corpus acadêmico versionado para regressão
- [ ] Separação explícita entre validação estrutural, sinal heurístico e avaliação acadêmica humana

## 7. Evolução supervisionada e eventual preparação de release

- [ ] Revisões por IA registradas a partir dos prompts existentes em `prompts/`
- [ ] Definição de licença (`LICENSE_PENDING.md` permanece pendente)
- [ ] Remoção ou migração demonstrada do legado de outro harness (`assets/opencode/`, dependência `@opencode-ai/plugin`, script `e2e:opencode`), com equivalência comprovada
- [ ] Preparação de release e cutover — **decisão do mantenedor; não autorizada por este roadmap**
- [ ] Acompanhamento contínuo de issues e PRs, preservando a PR #1 em revisão

## Marcos

| Marco | Descrição | Status |
|-------|-----------|--------|
| Protótipo experimental | Base acadêmica em `0.1.0`, `private`, `UNLICENSED`, com CI convencional | Atual |
| Integração nativa DSH | Tools, guard e preset registrados via Cordis no host | Proposto em draft (PR #1) |
| E2E DSH real | Execução nativa comprovada no SHA final, sem modelo | Pendente |
| Cobertura e correção validadas | Fluxo acadêmico integrado com corpus autorizado | Pendente |
| Release | Licença e publicação definidas pelo mantenedor | Não autorizado |

## Métricas de sucesso

- [x] CI executando na `master`
- [ ] E2E DSH real no SHA final
- [ ] Corpus acadêmico versionado e coberto por testes
- [ ] Nenhum segredo ou manuscrito real exposto em repositório, issue, commit ou PR
- [ ] Licença definida e release aprovado pelo mantenedor
