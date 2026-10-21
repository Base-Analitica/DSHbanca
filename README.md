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

**Experimental / protótipo (`0.1.0`)** — pacote `dshbanca`, `private: true`, `UNLICENSED`, sem publicação em npm. Nada neste repositório deve ser tratado como integração DSH concluída.

### Presente na `master` (`2302a75`)

- Empacotamento Cordis **declarado**: `package.json` expõe `./dsh` e `dsh.bundle.patch`; [`cordis.patch.yml`](cordis.patch.yml) monta `dshbanca/dsh`. Declarar o entrypoint não comprova que o host o carregou.
- `src/dsh.ts` declara `name = "dshbanca"`, injeta `skills` e registra um **provider de skills** quando `ctx.skills.registerProvider` existe.
- **16 módulos de ferramentas** em `src/tools/`, registrados no entry principal do pacote (`src/index.ts`), que ainda usa a interface `@opencode-ai/plugin`. A presença desses módulos não comprova dispatch nativo no DSH.
- **8 skills acadêmicas** em `skills/`.
- CI configurada e executada na `master`: [`.github/workflows/ci.yml`](.github/workflows/ci.yml) roda `typecheck`, `build`, `bun test`, `scripts/validate.sh` e `scripts/check-secrets.sh --ci`.

### Proposto na PR #1 (draft, `CHANGES_REQUESTED`)

A [PR #1](https://github.com/Base-Analitica/DSHbanca/pull/1), branch `fix/dsh-native-tools` (HEAD consultado `c6e7bd5`), propõe o registro nativo das tools acadêmicas via Cordis/`ctx.tools`, o guard de autorização/read-only do auditor, o preset do auditor e um gate E2E de perfil DSH. Enquanto essa PR permanecer draft e com revisão solicitada, **nada nela pode ser descrito como presente na `master` nem como funcionalidade disponível**.

### Pendente ou não comprovado

- **E2E DSH real no SHA final**: não comprovado. Resultado observado em SHA anterior da PR não vale como prova do HEAD atual. CI convencional, build e teste unitário não substituem esse gate.
- **Instruções Markdown do `banca-auditor`**: a associação e a projeção no Agent/sessão reais são o objeto da [issue #3](https://github.com/Base-Analitica/DSHbanca/issues/3), ainda bloqueada. Arquivo em `assets/`, nome de preset ou hash igual não provam carregamento.
- **Decisões acadêmicas por opções selecionáveis** ([issue #4](https://github.com/Base-Analitica/DSHbanca/issues/4)): direção de produto registrada, dependente da #3; não implementada aqui.
- **MCP, LaTeX/BibTeX real, corpus versionado e avaliação humana**: não validados de ponta a ponta por este plugin.

### Níveis de evidência usados nesta documentação

- `IMPLEMENTADO NA MASTER`: código presente na base `2302a75`.
- `PROPOSTO NA PR #1 (DRAFT)`: existe apenas em branch de PR, não incorporado.
- `TESTE LOCAL`: coberto por teste unitário/local; não prova integração nem host real.
- `E2E DSH NÃO COMPROVADO`: exigiria execução no DSH real no SHA final.
- `LEGADO OPENCODE`: artefato herdado de outro harness, preservado por histórico e não recomendado como integração DSH.

## O que o DSHbanca faz

Camada acadêmica presente no código da `master`, com os limites acima:

- ingestão do manuscrito LaTeX, com includes, proveniência por arquivo/linha e fingerprint;
- cobertura e segmentação em lotes canônicos, com checkpoints versionados e retomada;
- findings estruturados validados por plano, lote e proveniência, e entrada de síntese global condicionada à cobertura completa;
- rubricas e validações acadêmicas determinísticas;
- guardrails de correção, snapshots e política de restore;
- utilitários de referências/BibTeX, compilação LaTeX e relatórios.

Validações LaTeX/BibTeX verificam estrutura, includes e referências. Análise heurística de IA e de similaridade produz **sinais metodológicos**. Nenhuma delas constitui avaliação acadêmica humana, nota, aprovação ou reprovação.

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
│   ├── index.ts                 # Entry principal do pacote
│   ├── dsh.ts                   # Entry Cordis/DSH (provider de skills na master)
│   ├── lib/                     # Bibliotecas acadêmicas internas
│   └── tools/                   # 16 módulos de ferramentas acadêmicas
├── skills/                      # 8 skills acadêmicas empacotadas
├── assets/
│   ├── opencode/                # LEGADO OPENCODE: agentes, comandos e skills
│   └── templates/               # Templates (style-guide)
├── tests/                       # Testes (inclui runner legado de outro harness)
├── prompts/                     # Prompts para revisão por IA
└── scripts/                     # Scripts de validação
```

## Instalação

### Pré-requisitos

- **DSH (DeepSeek Harness)** instalado e capaz de carregar o bundle Cordis. A versão mínima **não está fixada nem comprovada** neste repositório.
- Node.js >= 18 ou Bun >= 1.x.
- LaTeX (TeX Live com `lualatex`) apenas para compilação; opcional.

Não há instrução de instalação publicada e validada para o DSHbanca: o pacote é `private` e `UNLICENSED`.

### Execução local do repositório

```bash
git clone https://github.com/Base-Analitica/DSHbanca.git
cd DSHbanca
bun install
bun run build
```

A instalação local foi exercitada apenas quanto a resolução de dependências e compilação TypeScript; não há validação de uso real no DSH.

> **Pacote npm: não publicado.** Não existe pacote público do DSHbanca no npm, e `@opencode/banca` não é um pacote aplicável a este projeto. O `package.json` marca `"private": true` e `"license": "UNLICENSED"`.

### Integração com o DSH

O repositório declara o bundle em `package.json` e `cordis.patch.yml` (id `dshbanca`, entry `dshbanca/dsh`). O carregamento efetivo pelo DSH **não foi comprovado no SHA final**; não existe comando de instalação validado a documentar aqui.

## Ferramentas e skills

### Ferramentas registradas na `master`

`src/tools/` contém 16 módulos, registrados no entry principal do pacote (`src/index.ts`) com os nomes abaixo:

| Ferramenta | Função |
|---|---|
| `banca_init` | Inicializa o projeto (`.banca/`) |
| `banca_status` | Estado atual do projeto |
| `banca_context` | Context pack para o host/LLM |
| `banca_auditar` | Auditoria por lotes canônicos |
| `banca_sintese` | Entrada de síntese global (exige cobertura completa) |
| `banca_corrigir` | Aplica correções com proteções |
| `banca_refs` | Referências (cadeia MCP → REST → cache) |
| `banca_ia` | Triagem heurística de padrões de IA |
| `banca_plagio` | Interpreta relatório CopySpider |
| `banca_loop` | Etapa assistida/preparatória do loop |
| `banca_snapshot` | Snapshot direcionado |
| `banca_restore` | Restauração a partir de snapshot |
| `banca_compile` | Compilação LaTeX |
| `banca_checklist` | Checklist de entrega |
| `banca_validate` | Valida `project.json` |
| `banca_contract` | Contrato pós-correção |

A exposição nativa dessas ferramentas no DSH depende da PR #1 (draft). Skills empacotadas em `skills/`: `banca-avaliacao`, `banca-correcao`, `banca-detector-ia`, `banca-grille`, `banca-plagio`, `banca-planejador`, `banca-referencias`, `banca-revisor` (8).

### Legado OpenCode

`assets/opencode/` preserva agentes, comandos e skills do outro harness; `package.json` conserva o script `e2e:opencode` e a dependência `@opencode-ai/plugin`. Isso é **legado histórico em migração**: não é caminho de operação do DSHbanca e não deve ser apresentado como integração DSH. A variável `OPENBANCA_ENABLE_CROSSREF_MCP` (e a equivalente `DSHBANCA_ENABLE_CROSSREF_MCP`) é lida pelo entry legado para auto-registrar um MCP; MCPs e integrações com provedores pertencem ao host e não são instrução operacional deste projeto.

## Como revisar com IA

O repositório mantém prompts prontos em `prompts/`:

- `prompts/ai-reviewer-general.md` - Revisão geral do projeto
- `prompts/ai-reviewer-code.md` - Revisão de código e estrutura
- `prompts/ai-reviewer-docs.md` - Revisão de documentação
- `prompts/ai-reviewer-security.md` - Revisão de segurança

Consulte [docs/ai-review-protocol.md](docs/ai-review-protocol.md) para o protocolo completo. Esse protocolo ainda contém nomenclatura do harness legado; se divergir da arquitetura DSH-only, trate a afirmação divergente como dívida documental.

## Limitações e riscos

- Nenhum fluxo de DSH está comprovado de ponta a ponta; a integração nativa está em PR draft.
- O detector de IA é heurístico e **não comprova autoria**; plágio e similaridade também são sinais, não vereditos.
- Um índice interno de auditoria **não representa aprovação ou reprovação acadêmica**.
- Referências via MCP não foram validadas com servidores reais nesta base.
- LaTeX/BibTeX real, corpus versionado e avaliação humana continuam pendentes.
- O consumo das instruções Markdown do `banca-auditor` pelo Agent depende da issue #3.
- LaTeX (`lualatex`) é opcional; sem ele não há compilação real.

## Como contribuir

Consulte [CONTRIBUTING.md](CONTRIBUTING.md) para o guia de contribuição.

## Segurança

Consulte [SECURITY.md](SECURITY.md) para a política de segurança e o canal de reporte. Correções acadêmicas, alteração de rubricas, scoring e julgamento institucional exigem autorização humana explícita; não use manuscritos reais sem autorização.

## Roadmap

Consulte [ROADMAP.md](ROADMAP.md) para o plano de desenvolvimento.

## Licença

Licença ainda não definida (`UNLICENSED`); ver [LICENSE_PENDING.md](LICENSE_PENDING.md). Não reutilize este projeto publicamente sem autorização do autor.

TODO: escolher uma licença apropriada (MIT, Apache-2.0, GPL-3.0 ou proprietária).
