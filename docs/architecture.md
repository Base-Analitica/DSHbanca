# Arquitetura do Sistema

## Invariante host-first

Por decisão vinculante da [issue #64](https://github.com/RenyEnnos/openbanca/issues/64), registrada operacionalmente na [issue #65](https://github.com/RenyEnnos/openbanca/issues/65), o OpenCode é o harness do sistema. O OpenBanca é um plugin/camada de domínio acadêmico e não deve duplicar a infraestrutura geral do host.

### Divisão de responsabilidades

| Responsável | Capacidades |
|---|---|
| **OpenCode (harness)** | Modelos e autenticação; sessões e contexto conversacional geral; agents e subagents; tool loop e delegação; commands; permissões; integração geral com provedores; configuração e lifecycle de MCPs. |
| **OpenBanca (domínio acadêmico)** | Representação canônica do manuscrito; segmentação e cobertura por lotes; rubricas e perfis institucionais; findings estruturados; proveniência e fingerprints; validações acadêmicas determinísticas; guardrails de correção; snapshots e changesets; estado específico do projeto; tools acadêmicas consumidas pelo OpenCode. |

O inventário de cada integração deve identificar proprietário do lifecycle, ambiente, credenciais, fallback e evidência E2E. A presença de uma integração no código não altera essa divisão de propriedade.

### Regra para novas integrações

Antes de criar cliente, adapter, runtime, servidor, subprocesso permanente ou integração, o agente deve executar o preflight host-first definido em [`AGENTS.md`](../AGENTS.md) e registrar no relatório: capacidade equivalente do OpenCode, API/configuração verificada, lacuna concreta, justificativa acadêmica, limite contra infraestrutura geral, evidência E2E em OpenCode real e plano de remoção/migração. Sem lacuna comprovada, usa-se o OpenCode.

### MCPs

MCPs são configurados e gerenciados pelo OpenCode por padrão. Processo, autenticação, lifecycle, observabilidade e chamadas genéricas pertencem ao host. O OpenBanca pode atuar sobre os resultados com matching de referências, normalização de metadados, cache acadêmico, TTL/invalidação, classificação de correspondência e interpretação/persistência de evidências.

Não criar nem ampliar cliente MCP genérico no OpenBanca. `src/lib/mcp_client.ts` permanece fora do escopo desta decisão documental e não deve evoluir como infraestrutura de produção. Um adapter interno só é permitido como exceção temporária documentada, com lacuna comprovada do OpenCode, escopo acadêmico limitado, teste E2E real, limites de segurança e plano de migração.

### Agents, loop e modelos

Seleção ou roteamento geral de modelos, autenticação direta em provedores de LLM, sessões paralelas, agent loop genérico, executor autônomo de subagents, permission engine próprio e sistema de commands paralelo pertencem ao harness e são proibidos no OpenBanca. `banca_loop` é apenas um fluxo preparatório/assistido; não deve se tornar um segundo harness. A coordenação acadêmica usa agents, skills, commands, tools, sessões e permissões do OpenCode.

Embeddings locais com modelos pequenos e classificadores/rerankers locais ficam como possibilidade futura auxiliar para memória, recuperação e deduplicação, após benchmark e decisão explícita do mantenedor. Não são prioridade do roadmap imediato, não substituem a cobertura exaustiva do manuscrito e não podem introduzir servidor autônomo, roteador geral ou segundo harness.

## Visão Geral

O OpenBanca é estruturado em camadas, com separação clara entre interface (tools), lógica de negócio (lib) e persistência (state, config).

## Camadas

```
┌─────────────────────────────────────────────────────┐
│                    Interface                         │
│  Tools (15) ← Comandos /banca:* ← Agentes/Skills   │
├─────────────────────────────────────────────────────┤
│                 Lógica de Negócio                    │
│  Lib: config, state, reports, paths, guards, ...    │
├─────────────────────────────────────────────────────┤
│                   Persistência                       │
│  .banca/project.json, state.json, reports/, ...     │
├─────────────────────────────────────────────────────┤
│      Integração Externa (gerenciada pelo OpenCode)  │
│  MCPs: crossref-academic, semantic-scholar, pubmed  │
└─────────────────────────────────────────────────────┘
```

## Componentes Principais

### Entry Point (`src/index.ts`)

O arquivo principal exporta o plugin para o OpenCode:

```typescript
const plugin: Plugin = async () => {
  // Lazy import das tools
  const { bancaInit } = await import("./tools/banca_init")
  // ...
  return {
    tool: { banca_init: bancaInit, ... },
    config: async (cfg) => { /* host-managed MCP config is opt-in */ },
  }
}
```

### Tools (`src/tools/`)

Cada tool é um módulo TypeScript que exporta uma tool do OpenCode:

```typescript
export const bancaAuditar = tool({
  description: "...",
  args: { projectRoot: z.string().optional(), ... },
  execute: async (args, ctx) => { ... },
})
```

**Tools disponíveis:**

| Tool | Arquivo | Responsabilidade |
|------|---------|------------------|
| `banca_init` | `banca_init.ts` | Inicialização de projeto |
| `banca_status` | `banca_status.ts` | Estado atual |
| `banca_context` | `banca_context.ts` | Context pack para LLM |
| `banca_auditar` | `banca_auditar.ts` | Auditoria 4 eixos |
| `banca_corrigir` | `banca_corrigir.ts` | Correção com guardrails |
| `banca_refs` | `banca_refs.ts` | Validação de referências |
| `banca_ia` | `banca_ia.ts` | Detecção de IA |
| `banca_plagio` | `banca_plagio.ts` | Verificação de plágio |
| `banca_loop` | `banca_loop.ts` | Loop de correção |
| `banca_snapshot` | `banca_snapshot.ts` | Snapshot do manuscrito |
| `banca_restore` | `banca_restore.ts` | Restauração de snapshot |
| `banca_compile` | `banca_compile.ts` | Compilação LaTeX |
| `banca_checklist` | `banca_checklist.ts` | Checklist de entrega |
| `banca_validate` | `banca_validate.ts` | Validação de config |
| `banca_contract` | `banca_contract.ts` | Contrato pós-correção |

### Libraries (`src/lib/`)

Bibliotecas internas que encapsulam lógica reutilizável:

| Library | Arquivo | Responsabilidade |
|---------|---------|------------------|
| `config` | `config.ts` | Carregamento/salvamento de configuração |
| `state` | `state.ts` | Gerenciamento de estado (score, iterações, snapshots) |
| `reports` | `reports.ts` | Geração e salvamento de relatórios |
| `paths` | `paths.ts` | Resolução de caminhos do manuscrito |
| `guards` | `guards.ts` | Guardrails (proteção de arquivos) |
| `cache` | `cache.ts` | Cache de referências |
| `mcp_client` | `mcp_client.ts` | Cliente para MCPs |
| `provider_chain` | `provider_chain.ts` | Cadeia de provedores (MCP → REST → cache) |
| `academic` | `academic.ts` | Utilidades acadêmicas |
| `bibtex` | `bibtex.ts` | Parser BibTeX |
| `latex` | `latex.ts` | Utilidades LaTeX |
| `install_assets` | `install_assets.ts` | Instalação de assets do OpenCode |
| `score` | `score.ts` | Cálculo de nota integrada |

### Assets (`assets/`)

Assets que são instalados no diretório `.opencode/` durante a inicialização:

#### Agentes (`assets/opencode/agents/`)

| Agente | Arquivo | Função |
|--------|---------|--------|
| `banca-auditor` | `banca-auditor.md` | Avalia monografia nos 4 eixos |
| `banca-corretor` | `banca-corretor.md` | Aplica correções ao texto |
| `banca-fontes` | `banca-fontes.md` | Gerencia referências bibliográficas |
| `banca-integrador` | `banca-integrador.md` | Integra notas dos eixos |
| `banca-loop` | `banca-loop.md` | Prepara etapa assistida do loop |

#### Skills (`assets/opencode/skills/`)

| Skill | Diretório | Função |
|-------|-----------|--------|
| `banca-avaliacao` | `banca-avaliacao/` | Workflow de avaliação |
| `banca-correcao` | `banca-correcao/` | Workflow de correção |
| `banca-detector-ia` | `banca-detector-ia/` | Workflow de detecção de IA |
| `banca-grille` | `banca-grille/` | Grade de avaliação |
| `banca-plagio` | `banca-plagio/` | Workflow de plágio |
| `banca-planejador` | `banca-planejador/` | Workflow de planejamento |
| `banca-referencias` | `banca-referencias/` | Workflow de referências |
| `banca-revisor` | `banca-revisor/` | Workflow de revisão |

#### Templates (`assets/templates/`)

| Template | Arquivo | Uso |
|----------|---------|-----|
| `style-guide` | `style-guide.md` | Guia de estilo ABNT |

## Fluxo de Execução

### Fluxo de Auditoria

```
/banca:auditar
    ↓
banca_auditar.ts
    ↓
loadConfig() → resolveManuscriptPaths()
    ↓
auditFichamento() → auditCitacoes() → auditConteudo() → auditEstilo()
    ↓
calculateIntegratedScore() → saveState()
    ↓
generateReport() → saveReport()
    ↓
Retorna resultado formatado
```

### Fluxo de Correção

```
/banca:corrigir
    ↓
banca_corrigir.ts
    ↓
loadConfig() → resolveManuscriptPaths()
    ↓
checkGuards() ← Verifica immutableFacts, protectedPaths
    ↓
addSnapshot() ← Backup antes de alterar
    ↓
applyCorrections() ← Aplica mudanças
    ↓
saveState() → generateReport()
    ↓
Retorna resultado
```

### Fluxo de Loop (Etapa Assistida)

O loop atual é preparatório/assistido (não executa correções ou compilações autônomas). O fluxo executado resume-se a:

```
/banca:loop correcao-continua
    ↓
banca_loop.ts
    ↓
Audita nota atual (citações) → Verifica circuit breakers
    ↓
Gera snapshot de segurança → Atualiza iterações no estado
    ↓
Gera relatório com próximos passos assistidos (executar /banca:auditar e /banca:corrigir)
```

## Decisões de Organização

### Por que tools são arquivos separados?

Cada tool tem responsabilidade única e pode ser importada individualmente via lazy loading. Isso reduz o tempo de inicialização.

### Por que lib/ existe?

A biblioteca interna separa lógica de negócio das tools, permitindo reutilização e testes independentes.

### Por que assets/ existe?

Os assets são arquivos estáticos que são copiados para `.opencode/` durante a inicialização. Manter separados facilita manutenção.

### Por que tests/ existe?

Testes garantem que as funcionalidades críticas funcionam corretamente. O Bun é usado como runner de testes.
