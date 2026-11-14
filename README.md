# DSHbanca

Plugin acadêmico para o **DSH (DeepSeek Harness)**, voltado à gestão, auditoria e correção de trabalhos acadêmicos (monografias, dissertações, TCCs).

## Harness, escopo e limites

**O DSH é o único harness deste projeto.** O DSHbanca é a camada de domínio acadêmico executada sobre ele e integrada nativamente por **Cordis**. Não existe compatibilidade dual, fallback para outro harness, runtime paralelo, roteador de modelos nem loop de agente próprio neste repositório.

| Componente | Responsabilidade |
|---|---|
| **DSH** | Runtime, modelos e autenticação, sessões/identidade/lifecycle de agentes, dispatch de tools, permissões, skills, plugins e configuração do ambiente. |
| **DSHbanca** | Ingestão e representação do manuscrito, cobertura e proveniência por lote, checkpoints e findings, rubricas, validações determinísticas, guardrails, snapshots e ferramentas acadêmicas. |

A separação acima é normativa; ela **não** comprova que todos os fluxos já estejam integrados ou executáveis no DSH. Consulte [AGENTS.md](AGENTS.md), [docs/architecture.md](docs/architecture.md) e [docs/terminal-agent-workflow.md](docs/terminal-agent-workflow.md).

### Relação com o OpenBanca

O **OpenBanca** é um **projeto separado**, mantido para o harness **OpenCode**. O DSHbanca é um repositório independente da organização Base Analítica, dedicado ao DSH. A existência do OpenBanca não cria compatibilidade, fallback nem autorização de cópia: nenhuma regra do outro projeto define a arquitetura deste repositório, e a licença deste projeto ainda não foi definida (ver [Licença](#licença)). Menções a OpenCode no código e na documentação são **legado histórico em migração**, não integração suportada.

## Estado atual

**Experimental / protótipo (`0.1.0`)** — pacote `dshbanca`, `private: true`, `UNLICENSED`, sem publicação em npm. O DSH é o único harness suportado.

### Presente na `master` (`3c24a53`)

- **Empacotamento Cordis integrado**: `package.json` expõe `./dsh`, `./cordis.patch.yml` e `dsh.bundle.patch`; [`cordis.patch.yml`](cordis.patch.yml) monta `dshbanca/dsh` e o preset `banca-auditor` no host.
- **Entrypoints nativos DSH-only**:
  - `src/dsh.ts`: plugin Cordis (`name = "dshbanca"`, `inject = ["skills", "tools"]`) que carrega e registra as 16 ferramentas acadêmicas (`ctx.tools.register`), aplica guard monotônico read-only (`ctx.tools.guard` e verificação no executor) e registra o provider nativo de skills (`ctx.skills.registerProvider`).
  - `src/index.ts`: entry principal DSH-only do pacote, reexportando `apply`, `name`, `inject` de `./dsh.js`, além dos utilitários de ferramentas e decisões acadêmicas (`src/lib/academic_decision.js`). A dependência legada `@opencode-ai/plugin` foi removida.
- **16 ferramentas acadêmicas nativas** em `src/tools/`, registradas via `ctx.tools.register` no `ToolRuntime` do DSH.
- **Guard read-only e enforcement de identidade**: bloqueio de ferramentas mutantes para o preset `banca-auditor*` e bloqueio de mutação de manuscrito para subagentes sem o preset `banca-corretor*`.
- **8 skills acadêmicas empacotadas** na fonte canônica `skills/`, expostas via `ctx.skills.registerProvider` sob o identificador `dshbanca`.
- **Corpus acadêmico sintético versionado v1** em `tests/fixtures/academic-coverage/v1/`: 10 cenários objetivos para regressão determinística de particionamento UTF-16, omissões e síntese (integrado na [PR #35](https://github.com/Base-Analitica/DSHbanca/pull/35)).
- **Auditoria durável por lote e gate de síntese**: avanço de checkpoints condicionado a confirmação explícita de auditoria por lote e bloqueio de síntese global até cobertura exaustiva (integrado na [PR #45](https://github.com/Base-Analitica/DSHbanca/pull/45)).
- **Contratos nativos de perguntas estruturadas e aprovação independente**: conformidade com `ctx.userQuestions` e `ctx.approval`, com garantia estrita de não-mutação na seleção de opções (integrado na [PR #47](https://github.com/Base-Analitica/DSHbanca/pull/47)).
- **Primeira decisão acadêmica selecionável nativa**: ciclo acadêmico não-mutante fundamentado em evidências e findings estruturados (integrado na [PR #49](https://github.com/Base-Analitica/DSHbanca/pull/49)).
- **Gate E2E de perfil DSH**: implementado em `scripts/e2e-dsh-profile.ts` (`bun run e2e:dsh:profile`) e documentado em [`docs/dsh-profile-e2e.md`](docs/dsh-profile-e2e.md).
- **CI configurada e executando na `master`**: [`.github/workflows/ci.yml`](.github/workflows/ci.yml) executa `typecheck`, `build`, `bun test`, `scripts/validate.sh` e `scripts/check-secrets.sh --ci`.

### PRs integradas recentemente

- **PR #1** ([#1](https://github.com/Base-Analitica/DSHbanca/pull/1), merge `820910f`): registro nativo das 16 ferramentas via `ctx.tools`, guard read-only do auditor, preset Cordis `banca-auditor` e runner E2E nativo.
- **PR #35** ([#35](https://github.com/Base-Analitica/DSHbanca/pull/35), merge `5ffedf4`): corpus sintético v1 para regressão determinística de particionamento e síntese.
- **PR #39** ([#39](https://github.com/Base-Analitica/DSHbanca/pull/39), merge `5bfa86d`): comprovação de discovery e carregamento nativo das 8 skills.
- **PR #41** ([#41](https://github.com/Base-Analitica/DSHbanca/pull/41), merge `e80d415`) e **PR #43** ([#43](https://github.com/Base-Analitica/DSHbanca/pull/43), merge `8371ba1`): consolidação da fonte canônica em `skills/` e desacoplamento do espelho legado.
- **PR #45** ([#45](https://github.com/Base-Analitica/DSHbanca/pull/45), merge `e326de7`): exigência de evidência durável de auditoria por lote antes do avanço e gate de síntese.
- **PR #47** ([#47](https://github.com/Base-Analitica/DSHbanca/pull/47), merge `9b8d672`): contratos nativos de perguntas estruturadas e aprovação independente.
- **PR #49** ([#49](https://github.com/Base-Analitica/DSHbanca/pull/49), merge `3c24a53`): implementação da primeira decisão acadêmica selecionável nativa não-mutante.

### Evidência E2E DSH real

O gate E2E do perfil DSH real foi executado e aprovado (`PASS`, exit code 0) no HEAD específico `aa39d371962f8cb1349af19fbc6acba78f4f4a85` da [PR #49](https://github.com/Base-Analitica/DSHbanca/pull/49) (com DSH `0.2.0-rc.2`, Cordis `4.0.4` e loader `1.0.5`), comprovando em host real sem modelos:
- Composição Cordis e montagem do bundle;
- Registro nativo das 16 ferramentas acadêmicas no DSH (`ctx.tools.register`);
- Descoberta e indexação das 16 ferramentas pelo `ToolRuntime` do host (`exactToolSet: true`);
- Despacho efetivo via `ctx.tools.execute` de um subconjunto de 8 ferramentas acadêmicas (`banca_init`, `banca_snapshot`, `banca_corrigir`, `banca_restore`, `banca_status`, `banca_context`, `banca_auditar`, `banca_sintese`) e da ferramenta nativa do host `ask_user_question`;
- Delimitação das 8 ferramentas acadêmicas não exercitadas individualmente na sonda E2E (`banca_refs`, `banca_ia`, `banca_plagio`, `banca_loop`, `banca_compile`, `banca_checklist`, `banca_validate`, `banca_contract`), validadas em testes unitários e herméticos locais (`bun test`);
- Guard monotônico read-only bloqueando mutações para `banca-auditor*` e subagentes;
- Descoberta e carregamento íntegro das 8 skills nativas;
- Ciclo de auditoria durável por lote e liberação da síntese;
- Perguntas estruturadas (`ctx.userQuestions`) com rejeição de chamador delegado (`DELEGATED_CALLER`), cancelamento (`ASK_ABORTED`) e garantia estrita de não-mutação;
- Quatro pares ordenados 1:1 de solicitação e decisão de aprovação (`ctx.approval`) em turno aberto de controle;
- Teardown limpo e descarte de agentes sem resíduos.

> [!IMPORTANT]
> A evidência E2E acima pertence estritamente ao SHA `aa39d371962f8cb1349af19fbc6acba78f4f4a85` no qual foi autorizada e executada. Ela **não** representa um novo teste E2E executado automaticamente no commit de merge da master (`3c24a53`).

### Pendente ou não comprovado

- **Interface Web real e interativa do DSH** ([issue #4](https://github.com/Base-Analitica/DSHbanca/issues/4)): a renderização de componentes interativos e a retomada em sessões persistidas ou reconectadas continuam abertas (`agent:blocked` e `needs:e2e`); a UI acadêmica não foi implementada nem validada. A investigação documental da [#70](https://github.com/Base-Analitica/DSHbanca/issues/70) foi concluída pela [PR #73](https://github.com/Base-Analitica/DSHbanca/pull/73) e pelo [relatório técnico](docs/audits/2026-11-05-dsh-preset-scoped-ui-feasibility.md), que não concede clearance de identidade live ou isolamento. Os gates atuais permanecem bloqueados: [#74](https://github.com/Base-Analitica/DSHbanca/issues/74) (identidade autoritativa do preset por Session) antecede [#75](https://github.com/Base-Analitica/DSHbanca/issues/75) (isolamento de abas e metadados restaurados); ambos mantêm `agent:blocked` e `needs:e2e`. A #4 (decisões/UX Web) e a [#62](https://github.com/Base-Analitica/DSHbanca/issues/62) (Creator scratch/segurança) continuam responsabilidades independentes.
- **Execução com modelos de IA reais**: nenhuma inferência de LLM ou credencial de provedor foi utilizada. O comportamento qualitativo do modelo em cenários reais não é comprovado por testes herméticos ou E2E sem modelo.
- **Avaliação acadêmica humana**: automações determinísticas, heurísticas de IA e similaridade fornecem sinais metodológicos, mas não constituem nota, aprovação, reprovação ou julgamento acadêmico institucional soberano.
- **LaTeX/BibTeX real arbitrário**: validação com compilador `lualatex` em documentos externos complexos e arbitrários de terceiros não foi exaurida de ponta a ponta.
- **Dívida residual da issue #50** ([issue #50](https://github.com/Base-Analitica/DSHbanca/issues/50)): follow-up não bloqueante (P3) para alinhar `phase: "unknown"` em entradas nulas de cancelamento no classificador do observer.
- **Licença e release formal**: o projeto permanece `private: true` e `UNLICENSED` ([LICENSE_PENDING.md](LICENSE_PENDING.md)); definições de licença e release pertencem exclusivamente ao mantenedor.

### Níveis de evidência usados nesta documentação

- `IMPLEMENTADO`: código presente na base `master` verificada (`3c24a53`).
- `TESTADO`: contrato validado por testes locais determinísticos ou CI (`bun test`, 1103 testes pass).
- `E2E DSH REAL`: comportamento observado no host DSH real (`0.2.0-rc.2` / Cordis `4.0.4`), associado a SHA específico (`aa39d37` na PR #49; `cb066a1` na PR #1).
- `NÃO COMPROVADO`: funcionalidade sem comprovação empírica no host real (ex.: interface Web, modelos de IA, avaliação acadêmica humana).
- `LEGADO OPENCODE`: artefato inativo mantido como dívida histórica em migração (`assets/opencode/`, runner `scripts/e2e-opencode.ts` e testes históricos), sem comando operacional no manifesto e sem suporte operacional.

## O que o DSHbanca faz

Camada acadêmica presente no código da `master`, com os limites acima:

- ingestão do manuscrito LaTeX, com includes, proveniência por arquivo/linha e fingerprint;
- cobertura e segmentação em lotes canônicos, com checkpoints versionados e retomada;
- findings estruturados validados por plano, lote e proveniência, e entrada de síntese global condicionada à cobertura completa;
- rubricas e validações acadêmicas determinísticas;
- guardrails de correção, snapshots e política de restore;
- utilitários de referências/BibTeX ([gramática suportada e limitações](docs/bibtex-parser-grammar.md)), compilação LaTeX e relatórios.

Validações LaTeX/BibTeX verificam estrutura e includes. `banca_refs` confere o estado das referências apenas contra o cache local; a validação externa de referências está bloqueada nesta base DSH-only. Análise heurística de IA e de similaridade produz **sinais metodológicos**. Nenhuma delas constitui avaliação acadêmica humana, nota, aprovação ou reprovação.

## Para quem é

- pessoas que escrevem trabalhos acadêmicos e usam o **DSH**;
- desenvolvedores de fluxos acadêmicos que consomem as tools e skills do DSHbanca;
- revisores de prompts/skills do bundle acadêmico.

## Estrutura do repositório

```text
.
├── README.md                    # Este arquivo
├── CHANGELOG.md                 # Histórico de mudanças
├── ROADMAP.md                   # Plano de desenvolvimento
├── CONTRIBUTING.md              # Guia de contribuição
├── SECURITY.md                  # Política de segurança
├── LICENSE_PENDING.md           # Licença (pendente)
├── package.json                 # Dependências e scripts
├── cordis.patch.yml             # Patch de bundle que monta dshbanca/dsh no DSH
├── docs/                        # Documentação técnica
├── src/
│   ├── index.ts                 # Entry principal do pacote (DSH-only)
│   ├── dsh.ts                   # Entry Cordis/DSH (tools, guard e provider de skills)
│   ├── lib/                     # Bibliotecas acadêmicas internas
│   └── tools/                   # 16 módulos de ferramentas acadêmicas
├── skills/                      # 8 skills acadêmicas empacotadas (fonte canônica)
├── assets/
│   ├── dsh/                     # Assets nativos DSH (agentes e presets)
│   ├── opencode/                # LEGADO OPENCODE: agentes, comandos e skills inativos
│   └── templates/               # Templates (style-guide)
├── tests/                       # Suíte de testes unitários e herméticos
├── prompts/                     # Prompts para revisão por IA
└── scripts/                     # Scripts de validação e runner E2E DSH
```

## Instalação

### Pré-requisitos

- **DSH (DeepSeek Harness)** instalado e capaz de carregar o bundle Cordis. A versão observada nas validações reais foi DSH `0.2.0-rc.2` com Cordis `4.0.4`.
- Node.js >= 18 ou Bun >= 1.x.
- LaTeX (TeX Live com `lualatex`) apenas para compilação; opcional.

Não há instrução de instalação publicada para usuários finais: o pacote é `private: true` e `UNLICENSED`.

### Execução local do repositório

```bash
git clone https://github.com/Base-Analitica/DSHbanca.git
cd DSHbanca
bun install --frozen-lockfile
bun run build
bun test
```

A instalação local executa resolução de dependências, compilação TypeScript e a suíte de testes unitários herméticos.

> **Pacote npm: não publicado.** Não existe pacote público do DSHbanca no npm. O `package.json` marca `"private": true` e `"license": "UNLICENSED"`.

### Integração com o DSH

O repositório declara o bundle em `package.json` e `cordis.patch.yml` (id `dshbanca`, entry `dshbanca/dsh`). O carregamento e funcionamento em perfil DSH real sem modelo foram observados em SHAs específicos sob autorização (ver [docs/dsh-profile-e2e.md](docs/dsh-profile-e2e.md)); a automação contínua no HEAD da master e a interface Web real permanecem pendentes.

## Ferramentas e skills

### Ferramentas registradas na `master`

`src/tools/` contém 16 módulos, registrados nativamente no entry DSH (`src/dsh.ts`) via `ctx.tools.register` e exportados no entry principal (`src/index.ts`):

| Ferramenta | Função |
|---|---|
| `banca_init` | Inicializa o projeto (`.banca/`) |
| `banca_status` | Estado atual do projeto |
| `banca_context` | Context pack para o host/LLM |
| `banca_auditar` | Auditoria por lotes canônicos |
| `banca_sintese` | Entrada de síntese global (exige cobertura completa) |
| `banca_corrigir` | Aplica correções com proteções |
| `banca_refs` | Referências: parsing BibTeX local, cache local como evidência e bloqueio explícito da validação externa |
| `banca_ia` | Triagem heurística de padrões de IA |
| `banca_plagio` | Interpreta relatório CopySpider |
| `banca_loop` | Etapa assistida/preparatória do loop |
| `banca_snapshot` | Snapshot direcionado |
| `banca_restore` | Restauração a partir de snapshot |
| `banca_compile` | Compilação LaTeX |
| `banca_checklist` | Checklist de entrega |
| `banca_validate` | Valida `project.json` |
| `banca_contract` | Contrato pós-correção |

As 16 ferramentas são registradas nativamente no `ToolRuntime` do DSH via `ctx.tools.register` com guard monotônico read-only (`ctx.tools.guard`) que bloqueia ferramentas mutantes para o auditor (`banca-auditor*`) e mutação do manuscrito para subagentes sem o preset corretor (`banca-corretor*`). O host DSH descobre e cataloga as 16 ferramentas (`exactToolSet: true`). A sonda E2E sem modelo (`scripts/e2e-dsh-profile.ts`) exercita o despacho de um subconjunto de 8 ferramentas acadêmicas (`banca_init`, `banca_snapshot`, `banca_corrigir`, `banca_restore`, `banca_status`, `banca_context`, `banca_auditar`, `banca_sintese`), além de `ask_user_question` do host; as 8 ferramentas restantes (`banca_refs`, `banca_ia`, `banca_plagio`, `banca_loop`, `banca_compile`, `banca_checklist`, `banca_validate`, `banca_contract`) são cobertas por testes unitários e herméticos locais (`bun test`), sem despacho individual no E2E. As 8 skills empacotadas na fonte canônica `skills/` (`banca-avaliacao`, `banca-correcao`, `banca-detector-ia`, `banca-grille`, `banca-plagio`, `banca-planejador`, `banca-referencias`, `banca-revisor`) são registradas pelo provider nativo `dshbanca` via `ctx.skills.registerProvider`.

### Legado OpenCode

`assets/opencode/` preserva agentes, comandos e skills herdados do outro harness; o runner `scripts/e2e-opencode.ts` e seus testes históricos permanecem no repositório como dívida técnica isolada, mas o script operacional `e2e:opencode` foi removido de `package.json` (a dependência `@opencode-ai/plugin` já havia sido removida). Isso é **legado histórico em migração**: não é caminho de operação do DSHbanca e não deve ser apresentado como integração suportada. Configurações como `DSHBANCA_ENABLE_CROSSREF_MCP` pertencem a integrações legadas; no DSH, MCPs e integrações com provedores pertencem ao host e não são instruções operacionais deste plugin.

## Como revisar com IA

O repositório mantém prompts prontos em `prompts/`:

- `prompts/ai-reviewer-general.md` - Revisão geral do projeto
- `prompts/ai-reviewer-code.md` - Revisão de código e estrutura
- `prompts/ai-reviewer-docs.md` - Revisão de documentação
- `prompts/ai-reviewer-security.md` - Revisão de segurança

Consulte [docs/ai-review-protocol.md](docs/ai-review-protocol.md) para o protocolo completo. Esse protocolo ainda contém nomenclatura do harness legado; se divergir da arquitetura DSH-only, trate a afirmação divergente como dívida documental.

## Limitações e riscos

- O gate E2E do perfil DSH real sem modelo foi validado em SHAs específicos (`aa39d37` na PR #49; `cb066a1` na PR #1) e não constitui execução automática no commit de merge da `master`.
- A interface Web interativa e a retomada em sessões desconectadas permanecem abertas e pendentes de validação no DSH ([issue #4](https://github.com/Base-Analitica/DSHbanca/issues/4)).
- Nenhum modelo de IA real foi executado nesta base; avaliações de qualidade, estilo ou deliberação dependentes de modelo não são comprovadas por testes herméticos.
- O detector de IA é heurístico e **não comprova autoria**; detecção de plágio e similaridade também são sinais metodológicos, não vereditos.
- Um índice interno de auditoria **não representa aprovação ou reprovação acadêmica** nem substitui avaliação acadêmica humana institucional.
- Compilação LaTeX (`lualatex`) real de ponta a ponta em documentos arbitrários de terceiros permanece não exaurida. A validação externa de referências **não está disponível** nesta base DSH-only: [`banca_refs`](src/tools/banca_refs.ts) lê o BibTeX local, reutiliza o cache local (`.banca/cache/refs.json`) como evidência e marca `bloqueada`/`external_transport_blocked` toda referência sem resultado positivo, sem `fetch`, MCP próprio ou fallback REST; sintaxe BibTeX válida não comprova existência da publicação (ver [como interpretar `banca_refs`](docs/usage.md#como-interpretar-banca_refs)).
- O projeto permanece `private: true` e `UNLICENSED` ([LICENSE_PENDING.md](LICENSE_PENDING.md)).

## Como contribuir

Consulte [CONTRIBUTING.md](CONTRIBUTING.md) para o guia de contribuição.

## Segurança

Consulte [SECURITY.md](SECURITY.md) para a política de segurança e o canal de reporte. Correções acadêmicas, alteração de rubricas, scoring e julgamento institucional exigem autorização humana explícita; não use manuscritos reais sem autorização.

## Roadmap

Consulte [ROADMAP.md](ROADMAP.md) para o plano de desenvolvimento.

## Licença

Licença ainda não definida (`UNLICENSED`); ver [LICENSE_PENDING.md](LICENSE_PENDING.md). Não reutilize este projeto publicamente sem autorização do autor.

TODO: escolher uma licença apropriada (MIT, Apache-2.0, GPL-3.0 ou proprietária).
