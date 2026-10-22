# Instalação e preparação local

Guia detalhado de **preparação local do repositório** DSHbanca. Para a versão curta, consulte [install.md](install.md).

> Não há fluxo de instalação e uso final validado no DSH a recomendar. Resolver dependências e compilar TypeScript não equivale a instalar funcionalmente o plugin no host.

## Destino exclusivo e responsabilidades

**DSH (DeepSeek Harness) é o único harness; Cordis é o mecanismo de composição com o host.** Runtime, modelos e autenticação, sessões, agentes e lifecycle, dispatch de tools, skills e permissões pertencem ao DSH.

O DSHbanca possui somente o domínio acadêmico: ingestão e cobertura do manuscrito, lotes, checkpoints, fingerprints, rubricas, findings e proveniência, validações acadêmicas, guardrails, snapshots e changesets. Essa separação é normativa, não prova de integração operacional. Não há suporte dual ou fallback; não se deve criar SDK paralelo, roteador de modelos, MCP próprio ou executor genérico no plugin.

OpenBanca é outro projeto, voltado ao OpenCode. Referências a esse harness no código são **legado não suportado**, não instruções de instalação DSH.

Fontes normativas: [governança](../AGENTS.md), [arquitetura](architecture.md), [protocolo de revisão por IA](ai-review-protocol.md) e [fluxo de agentes no terminal](terminal-agent-workflow.md). Consulte também o [README](../README.md) e o [roadmap](../ROADMAP.md); os SHAs históricos citados nesses documentos não são prova de um HEAD posterior.

## Pacote e disponibilidade

Na base `origin/master` verificada para esta revisão, `d25fee6cc8b84731183e18a0287e23e221ac4ce7`, o [package.json](../package.json) declara `dshbanca`, versão interna `0.1.0`, `private: true` e `UNLICENSED`.

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
- `build` executa `tsc`, conforme [package.json](../package.json), e gera `dist/` segundo [tsconfig.json](../tsconfig.json).
- Esses passos **não registram, carregam ou instalam funcionalmente o bundle no DSH**. Um build bem-sucedido só comprova compilação naquele ambiente e SHA.

Verificações locais opcionais, declaradas no pacote ou usadas pela CI:

```bash
bun run typecheck
bun run validate:skills
bun run validate:agents
bash scripts/validate.sh
bash scripts/check-secrets.sh --ci
```

Os validadores de skills/agentes da base examinam assets legados; não comprovam discovery no DSH. O verificador de segredos em modo CI exclui documentação e prompts, portanto não substitui sua revisão manual. Nenhum desses gates é E2E DSH.

**Não execute a suíte integral sem preflight:** a base ainda contém [tests/e2e-opencode.test.ts](../tests/e2e-opencode.test.ts) e o [runner legado](../scripts/e2e-opencode.ts). O teste dinâmico pode resolver um executável externo, copiar autenticação do host e solicitar modelo. Antes da suíte, comprove isolamento de HOME, PATH, configuração, executáveis e credenciais, além da ausência de execução involuntária de modelo, conforme o [fluxo terminal](terminal-agent-workflow.md). Sem essa prova, registre o gate como `BLOCKED`, não `PASS`; não use outro harness ou fallback para contorná-lo.

## Master, PR e E2E pendente

| Item | Presente na master da base acima | Proposta na PR #1 | Limite da evidência |
|---|---|---|---|
| Empacotamento | Export `./dsh` e `dsh.bundle.patch` no pacote; [cordis.patch.yml](../cordis.patch.yml) aponta para `dshbanca/dsh` | Composição ampliada | Declaração não prova carregamento pelo host |
| Skills | [src/dsh.ts](../src/dsh.ts) declara `name`, `inject` e provider condicionado a `ctx.skills.registerProvider` | Provider mantido com integração ampliada | Registro no código não prova discovery ou associação |
| Ferramentas | 16 módulos registrados no entry legado [src/index.ts](../src/index.ts), com interface `@opencode-ai/plugin`; sem registro nativo de tools em `src/dsh.ts` | Registro nativo via `ctx.tools` e guard do auditor | Não são 16 ferramentas executáveis no DSH da master |
| Gate E2E de perfil | Não há script `e2e:dsh:profile` no pacote da base | Runner e gate propostos | CI, mocks e build não substituem E2E DSH no SHA final |
| Markdown do auditor | Asset legado não comprova associação/projeção no Agent | Implementação e reparos vinculados à issue #3 | Aceite bloqueado; evidência de SHA anterior não comprova o HEAD final |

A [PR #1](https://github.com/Base-Analitica/DSHbanca/pull/1), branch `fix/dsh-native-tools`, HEAD consultado `c6e7bd5c54583868e351d0c80ce957d287e2a9a0`, continua **draft/CHANGES_REQUESTED**, não incorporada à master. A [issue #3](https://github.com/Base-Analitica/DSHbanca/issues/3) permanece bloqueada quanto à prova real do Markdown no HEAD final; a [issue #4](https://github.com/Base-Analitica/DSHbanca/issues/4) depende dela. Este guia não resolve esses bloqueios.

Não há aqui comando CLI DSH de instalação, configuração operacional do host ou versão de pacote publicado validada. A cadeia de prova é arquivo → registro declarado → discovery → associação a Agent/Session → dispatch/enforcement, conforme o [protocolo de revisão](ai-review-protocol.md#cadeia-de-verificação-da-integração-dshcordis). O próximo gate de integração exige DSH real no SHA final e autorização própria; não faz parte deste preparo.

## Instruções legadas retiradas

Não use como instalação ou operação DSHbanca: requisito de versão OpenCode, pacote `@opencode/banca`, configuração `opencode.json`, instalação em `.opencode/`, comandos `/banca:*` ou `/banca-init`, nem `OPENBANCA_ENABLE_CROSSREF_MCP` ou seu alias `DSHBANCA_ENABLE_CROSSREF_MCP`. São referências históricas **não suportadas**. MCP externo não é requisito de integração do host; seu lifecycle pertence ao DSH. A existência de código legado não o torna caminho recomendado.

## Limitações e dívida fora do escopo

Este guia não comprova consumo Markdown, uso de modelo/credenciais, qualidade acadêmica, nota institucional, compilação LaTeX real, integração MCP ou correção/snapshot como operação final no DSH. Índices e heurísticas não equivalem a avaliação acadêmica humana.

A migração de código e runner legados e as instruções remanescentes em [uso](usage.md), [visão geral](overview.md), [MCPs](mcps.md), [especificação de skills](skill-spec.md), [troubleshooting](troubleshooting.md) e [contribuição](../CONTRIBUTING.md) exigem trabalho separado. Não interprete orientações antigas nesses arquivos como compatibilidade suportada nem como substituição da governança DSH-only.
