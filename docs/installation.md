# Instalação e preparação local

Guia detalhado de **preparação local do repositório** DSHbanca. Para a versão curta, consulte [install.md](install.md).

> A integração nativa DSH/Cordis está incorporada na `master` e foi observada em SHAs históricos (ver [evidências nativas e limites](#evidências-nativas-e-limites)), mas **não há fluxo de instalação e uso final validado no DSH a recomendar**. Resolver dependências e compilar TypeScript não equivale a instalar funcionalmente o plugin no host.

## Destino exclusivo e responsabilidades

**DSH (DeepSeek Harness) é o único harness; Cordis é o mecanismo de composição com o host.** Runtime, modelos e autenticação, sessões, agentes e lifecycle, dispatch de tools, skills e permissões pertencem ao DSH.

O DSHbanca possui somente o domínio acadêmico: ingestão e cobertura do manuscrito, lotes, checkpoints, fingerprints, rubricas, findings e proveniência, validações acadêmicas, guardrails, snapshots e changesets. Essa separação é normativa, não prova de integração operacional. Não há suporte dual ou fallback; não se deve criar SDK paralelo, roteador de modelos, MCP próprio ou executor genérico no plugin.

OpenBanca é outro projeto, voltado ao OpenCode. Referências a esse harness no código são **legado não suportado**, não instruções de instalação DSH.

Fontes normativas: [governança](../AGENTS.md), [arquitetura](architecture.md), [protocolo de revisão por IA](ai-review-protocol.md) e [fluxo de agentes no terminal](terminal-agent-workflow.md). Consulte também o [README](../README.md) e o [roadmap](../ROADMAP.md); os SHAs históricos citados nesses documentos não são prova de um HEAD posterior.

## Pacote e disponibilidade

Na base `origin/master` verificada para esta revisão, `9e338618d4e4269b1f0909343c9fe1a6a9738ac8` (14/11/2026), o [package.json](../package.json) declara `dshbanca`, versão interna `0.1.0`, `private: true` e `UNLICENSED`.

- `private: true` impede publicação via gerenciador de pacotes; não é um canal de distribuição.
- `UNLICENSED` não concede licença de reutilização pública. A definição de licença permanece pendente; veja [LICENSE_PENDING.md](../LICENSE_PENDING.md).
- Não há publicação oficial do DSHbanca nem comando de instalação de pacote publicado a recomendar.
- Publicação, release e licença dependem de decisão do mantenedor; este guia não promete publicação futura no npm.

## Pré-requisitos

| Componente | Finalidade e limite |
|---|---|
| Git | Clonar o repositório para desenvolvimento local |
| Bun | Executar os comandos deste guia. A [CI](../.github/workflows/ci.yml) fixa `1.3.9`; isso é uma referência de execução, não uma versão mínima suportada comprovada |
| DSH/Cordis | Destino exclusivo para futura instalação funcional. A **versão mínima de DSH não foi validada**, nem foi estabelecida uma faixa suportada de Cordis. Não é necessário iniciar o host para preparar o repositório |
| Bash e Node.js | Usados pelo validador shell opcional; não substituem o Bun nos comandos apresentados |
| LaTeX | Opcional, apenas para compilação de manuscritos; não é requisito de preparo local e não há prova de compilação real de ponta a ponta neste guia |

O preparo não exige modelo, credenciais de provedor nem MCP externo. Clone e resolução de dependências podem exigir rede; em ambiente sem rede, dependem de checkout e cache já provisionados. Não configure provedores ou copie credenciais para preparar o repositório.

## Preparação local, não instalação no host

```bash
git clone https://github.com/Base-Analitica/DSHbanca.git
cd DSHbanca
bun install --frozen-lockfile
bun run build
```

- A instalação usa o [lockfile versionado](../bun.lock), sem autorizar atualização de dependências.
- `build` executa `tsc` e o bundle de [src/lib/tools.ts](../src/lib/tools.ts), conforme [package.json](../package.json), e gera `dist/` segundo [tsconfig.json](../tsconfig.json).
- Esses passos **não registram, carregam ou instalam funcionalmente o bundle no DSH**. Um build bem-sucedido só comprova compilação naquele ambiente e SHA.

Verificações locais opcionais, declaradas no pacote ou usadas pela CI:

```bash
bun run typecheck
bun run validate:skills
bun run validate:agents
bash scripts/validate.sh
bash scripts/check-secrets.sh --ci
```

Os validadores examinam o frontmatter das 8 skills canônicas em `skills/` e dos agentes em `assets/dsh/agents/`; não comprovam discovery, associação a Agent ou projeção de instruções no DSH. O verificador de segredos em modo CI exclui documentação e prompts, portanto não substitui sua revisão manual. Nenhum desses gates é E2E DSH.

**Não execute a suíte integral sem preflight:** a base ainda contém [tests/e2e-opencode.test.ts](../tests/e2e-opencode.test.ts) e o [runner legado](../scripts/e2e-opencode.ts). O teste dinâmico pode resolver um executável externo, copiar autenticação do host e solicitar modelo. Antes da suíte, comprove isolamento de HOME, PATH, configuração, executáveis e credenciais, além da ausência de execução involuntária de modelo, conforme o [fluxo terminal](terminal-agent-workflow.md). Sem essa prova, registre o gate como `BLOCKED`, não `PASS`; não use outro harness ou fallback para contorná-lo.

## Integração nativa, evidência histórica e limites

Na base `9e33861`, a integração DSH/Cordis está **incorporada**; o que falta é distribuição, instalação funcional no host e evidência para o HEAD atual. A tabela distingue código presente, evidência nativa histórica e limite:

| Item | Estado na master (`9e33861`) | Evidência nativa histórica (SHA específico) | Limite |
|---|---|---|---|
| Empacotamento | `package.json` expõe `./dsh` e `./cordis.patch.yml`, e declara `dsh.bundle.patch`; [cordis.patch.yml](../cordis.patch.yml) monta `dshbanca/dsh` e o preset `banca-auditor` via `@deepseek-ai/dsh-agent-preset` e `@deepseek-ai/dsh-agent-instructions`. | Composição Cordis e boot do perfil observados em `cb066a1` (PR #1) e `aa39d37` (PR #49). | Declaração/build não provam carregamento em outro host ou perfil; não há faixa mínima de DSH/Cordis validada. |
| Entrypoint | [src/index.ts](../src/index.ts) é DSH-only e reexporta `apply`/`name`/`inject` de [src/dsh.ts](../src/dsh.ts); `@opencode-ai/plugin` não está nas dependências. | `build`/`typecheck` herméticos e instalação offline do bundle no E2E. | Entry correto não prova registro efetivo no host sem observação nativa. |
| Ferramentas | 16 ferramentas nativas registradas via `ctx.tools.register` em [src/dsh.ts](../src/dsh.ts), a partir de [src/lib/tools.ts](../src/lib/tools.ts). | 16 descobertas (`exactToolSet: true`) em `cb066a1` e `aa39d37`; despacho de 5 em `cb066a1` (`banca_init`, `banca_snapshot`, `banca_corrigir`, `banca_restore`, `banca_status`) e de 8 em `aa39d37` (`banca_init`, `banca_snapshot`, `banca_corrigir`, `banca_restore`, `banca_status`, `banca_context`, `banca_auditar`, `banca_sintese`) e `ask_user_question`. | As 11 ferramentas não despachadas em `cb066a1` e as 8 não despachadas em `aa39d37` têm testes unitários/herméticos, sem despacho individual no E2E; discovery não é dispatch. |
| Guard read-only | `ctx.tools.guard` deny-only mais revalidação no executor: nega ferramentas mutantes de workspace para `banca-auditor*` e mutação de manuscrito para subagente sem `banca-corretor*`, antes do corpo. | Negação pré-corpo de `banca_corrigir`/`banca_restore`, `banca_status` permitido e hashes preservados em `cb066a1` e `aa39d37`. | Identidade depende de headers/presets do host; não cobre o lifecycle do subagent manager em produção. |
| Skills | Provider `dshbanca` via `ctx.skills.registerProvider` (rank 550) expõe as 8 skills canônicas de [skills](../skills/). | Descoberta, carregamento e integridade SHA-256 das 8 observados em `aa39d37`. | Discovery/carregamento no registry não prova aplicação das instruções por modelo; consolidação canônica pendente ([issue #23](https://github.com/Base-Analitica/DSHbanca/issues/23)). |
| Markdown do auditor | O preset declara o loader de instruções `banca-auditor.md` (65.536 bytes, sem candidatos locais); a fonte canônica fica em [assets/dsh/agents/banca-auditor.md](../assets/dsh/agents/banca-auditor.md). | Projeção `agent-instructions` como mensagem `user-message` no auditor e ausência no agente de controle observadas em `cb066a1`; aceite da [issue #3](https://github.com/Base-Analitica/DSHbanca/issues/3) encerrada. | Instrução não é permissão nem controle de acesso; consumo por modelo não comprovado. |
| Gate E2E de perfil | Script `e2e:dsh:profile` em [package.json](../package.json) e [scripts/e2e-dsh-profile.ts](../scripts/e2e-dsh-profile.ts); contrato em [dsh-profile-e2e.md](dsh-profile-e2e.md); o relatório versionado em [docs/evidence/dsh-profile-e2e.latest.json](evidence/dsh-profile-e2e.latest.json) registra `BLOCKED`. | Execuções autorizadas PASS em `cb066a1`, `aa39d37` e nos HEADs das verticais 01–05. | A CI só executa com `DSH_PROFILE_E2E_ENABLED=true`; sem provisionamento registra `BLOCKED`. O HEAD atual não tem E2E, e nenhuma execução autoriza outra. |

A [PR #1](https://github.com/Base-Analitica/DSHbanca/pull/1) foi integrada (merge `820910f8cb0eb93e5bc0090040b9cde601de397e`, 29/10/2026), com HEAD final `cb066a10d9bf88af0be5eb832eb794de44e0383d`; os estados de draft e `CHANGES_REQUESTED` são **histórico superado**; as correções das 14 revisões históricas estão nos commits da branch da PR #1, rastreados e mapeados no gate da [issue #33](https://github.com/Base-Analitica/DSHbanca/issues/33). A [issue #3](https://github.com/Base-Analitica/DSHbanca/issues/3) foi encerrada em 27/10/2026 após execução nativa autorizada; isso não encerra a [issue #4](https://github.com/Base-Analitica/DSHbanca/issues/4), cujos gates próprios permanecem [#74](https://github.com/Base-Analitica/DSHbanca/issues/74) e [#75](https://github.com/Base-Analitica/DSHbanca/issues/75), nem autoriza modelo, UX ou Web.

## Evidências nativas e limites

| Evidência | SHA observado (HEAD da PR) | Merged em | Runtime | Observado | Limite |
|---|---|---|---|---|---|
| PR #1 — identidade, lifecycle, tools e Markdown | `cb066a10d9bf88af0be5eb832eb794de44e0383d` | `820910f` (PR #1) | DSH `0.2.0-rc.2`, Cordis `4.0.4`, loader `1.0.5` | Agent/Session nativos, preset `banca-auditor`, `agent/pre-step`, Markdown `agent-instructions` no auditor e não no controle, 16 tools descobertas (`exactToolSet: true`), despacho de 5 (`banca_init`, `banca_snapshot`, `banca_corrigir`, `banca_restore`, `banca_status`), guard negando `banca_corrigir`/`banca_restore` antes do corpo e `banca_status` permitido, teardown; zero modelo | `Agent.send` apenas sintético e rejeitado antes de `step/start`/`agent/request`; 11 tools sem despacho individual; sem Web, modelo ou manuscrito real |
| PR #49 — skills, perguntas, aprovação e decisão | `aa39d371962f8cb1349af19fbc6acba78f4f4a85` | `3c24a53` (PR #49) | DSH `0.2.0-rc.2`, Cordis `4.0.4`, loader `1.0.5` | composição, 16 tools descobertas, despacho de 8 + `ask_user_question`, guard, 8 skills com integridade, `ctx.userQuestions`/`ctx.approval`, decisão acadêmica não-mutante | sem modelo (duas chamadas `Agent.send` sintéticas rejeitadas antes de `step/start`); 8 tools sem despacho individual; UI Web e retomada interativa pendentes ([issue #4](https://github.com/Base-Analitica/DSHbanca/issues/4)) |
| Vertical 01 ([#98](https://github.com/Base-Analitica/DSHbanca/issues/98)/[PR #99](https://github.com/Base-Analitica/DSHbanca/pull/99)) | `9679a23ec4d94332a4be529a4c0dc9e434277017` | `8deee59` | DSH `0.2.0-rc.2`, Cordis `4.0.4`, loader `1.0.5` | 5/5 lotes, 595/595 caracteres, quatro lotes sem findings e um finding sintético não vazio do recibo até `banca_sintese` | dados sintéticos; sem modelo ou qualidade acadêmica |
| Vertical 02 ([#100](https://github.com/Base-Analitica/DSHbanca/issues/100)/[PR #101](https://github.com/Base-Analitica/DSHbanca/pull/101)) | `fc65aa403ee8550260b88dd60695ef9ac1872347` | `24a8083` | DSH `0.2.0-rc.2`, Cordis `4.0.4`, loader `1.0.5` | segundo Agent/Session nativo retoma 2/5→5/5, 17 despachos, finding uma vez, teardown | mesmo processo DSH do observador; sem modelo |
| Vertical 03 ([#103](https://github.com/Base-Analitica/DSHbanca/issues/103)/[PR #104](https://github.com/Base-Analitica/DSHbanca/pull/104)) | `c0cddbe4661d6f1a30c1ba14f740c674f35d7d84` | `e3ed3a2` | DSH `0.2.1-rc.5`, Cordis `4.0.5`, loader `1.0.6` | dois processos DSH reais sequenciais 2/5→5/5, cinco recibos, finding uma vez, negativas de avanço/síntese | sem queda de máquina/kernel; sem modelo |
| Vertical 04 ([#105](https://github.com/Base-Analitica/DSHbanca/issues/105)/[PR #106](https://github.com/Base-Analitica/DSHbanca/pull/106)) | `0283bae86cee7e7bc44aa791344e68337ed3791c` | `5e31e25` | DSH `0.2.1-rc.5`, Cordis `4.0.5`, loader `1.0.6` | drift de fonte sintético entre processos: fingerprint/planId novos, 0/5, sem herança, quatro negativas de domínio | não cobre reauditoria completa da versão nova; sem modelo |
| Vertical 05 ([#107](https://github.com/Base-Analitica/DSHbanca/issues/107)/[PR #108](https://github.com/Base-Analitica/DSHbanca/pull/108)) | `4c8a136a19f81a24d9715bbea1d98d969d1b5541` | `e37551f` | DSH `0.2.1-rc.5`, Cordis `4.0.5`, loader `1.0.6` | término abrupto após checkpoint durável: recuperação no segundo processo 2/5→5/5, prova de fronteira de processo e par relatório/comprovante | não testa queda durante escrita/fsync, kernel, energia ou filesystem; sem modelo |

As evidências acima são **SHA-scoped**: cada uma pertence ao HEAD da PR indicada e foi observada em host real sem modelo, com workspace LaTeX/BibTeX sintético, scratch isolado e autorização humana específica; **não foram reexecutadas no commit de merge nem no HEAD atual `9e33861`**. CI convencional, build, testes herméticos e fixtures não substituem E2E. Nenhuma evidência aqui comprova: todas as 16 ferramentas despachadas individualmente, inferência ou qualidade de modelo, UX Web, retomada de sessão reconectada, avaliação acadêmica humana, compilação LaTeX real de terceiros ou distribuição do pacote. O contrato operacional do gate — pré-condições, variáveis e limites — está em [dsh-profile-e2e.md](dsh-profile-e2e.md); ele descreve comportamento condicionado, **não autorização**, e o estado de execução de cada folha está nos aceites das respectivas issues/PRs.

Não há aqui comando CLI DSH de instalação, configuração operacional do host ou versão de pacote publicado validada. A cadeia de prova é arquivo → bundle/registro → discovery → associação a Agent/Session → dispatch/enforcement, conforme o [protocolo de revisão](ai-review-protocol.md#cadeia-de-verificação-da-integração-dshcordis). Qualquer nova alegação de integração — inclusive em novo HEAD — exige E2E DSH real nesse SHA, com autorização própria; não faz parte deste preparo.

## Instruções legadas retiradas

Não use como instalação ou operação DSHbanca: requisito de versão OpenCode, pacote `@opencode/banca`, configuração `opencode.json`, instalação em `.opencode/`, comandos `/banca:*` ou `/banca-init`, nem `OPENBANCA_ENABLE_CROSSREF_MCP` ou seu alias `DSHBANCA_ENABLE_CROSSREF_MCP`. São referências históricas **não suportadas**. MCP externo não é requisito de integração do host; seu lifecycle pertence ao DSH. A existência de código legado não o torna caminho recomendado.

## Limitações e dívida fora do escopo

Este guia não comprova consumo das instruções Markdown por modelo, uso de modelo/credenciais, qualidade acadêmica, nota institucional, compilação LaTeX real, integração MCP ou correção/snapshot como operação final no DSH. Índices e heurísticas não equivalem a avaliação acadêmica humana.

Permanecem pendentes, com gates próprios e sem desbloqueio nesta revisão: [#4](https://github.com/Base-Analitica/DSHbanca/issues/4), [#74](https://github.com/Base-Analitica/DSHbanca/issues/74) e [#75](https://github.com/Base-Analitica/DSHbanca/issues/75) (UX Web, identidade autoritativa do preset por Session e isolamento de abas), [#62](https://github.com/Base-Analitica/DSHbanca/issues/62) (Creator real e fronteira de permissões), [#23](https://github.com/Base-Analitica/DSHbanca/issues/23) (fonte canônica das skills), [#50](https://github.com/Base-Analitica/DSHbanca/issues/50) (classificador do observer), [#102](https://github.com/Base-Analitica/DSHbanca/issues/102)/[PR #125](https://github.com/Base-Analitica/DSHbanca/pull/125) (correção do aviso de limitações do relatório — Agent criado × turno de modelo; E2E bloqueado) e [#124](https://github.com/Base-Analitica/DSHbanca/issues/124) (alinhamento das instruções de `banca-referencias`/`banca-fontes` ao contrato fail-closed). A [issue-mãe #109](https://github.com/Base-Analitica/DSHbanca/issues/109) permanece aberta. O encerramento da [issue #3](https://github.com/Base-Analitica/DSHbanca/issues/3) não desbloqueia automaticamente Web, modelos, isolamento ou autorização.

A migração de código e runner legados e as instruções remanescentes em [uso](usage.md), [visão geral](overview.md), [MCPs](mcps.md), [especificação de skills](skill-spec.md), [troubleshooting](troubleshooting.md) e [contribuição](../CONTRIBUTING.md) exigem trabalho separado. Não interprete orientações antigas nesses arquivos como compatibilidade suportada nem como substituição da governança DSH-only.

Para o estado operacional e os contratos das ferramentas acadêmicas, consulte o [guia de uso](usage.md); para o preparo rápido, o [guia de instalação](install.md).
