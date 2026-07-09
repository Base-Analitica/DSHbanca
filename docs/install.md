# Instalação

## Pré-requisitos
- OpenCode >= 1.x
- Node.js >= 18 ou Bun >= 1.x
- LaTeX: TeX Live com lualatex (opcional)

## Instalação

```json
// opencode.json
{
  "plugin": ["@opencode/banca"]
}
```

```bash
npm install @opencode/banca
# ou
bun add @opencode/banca
```

## Inicialização

```bash
/banca:init
```

Cria `.banca/` + `.opencode/` (agents, commands, skills, templates):

```
.banca/
  project.json      # configuração
  state.json        # estado (score, iterações, snapshots)
  scorecard.md
  iterations.md
  checklist.md
  knowledge.md
  reports/
  context/
  snapshots/
  cache/
.opencode/
  agents/           # @banca-* agents
  commands/         # /banca:* comandos
  skills/           # skills disponíveis
```

## Ferramentas (15)

| Tool | Descrição |
|------|-----------|
| `/banca:init` | Inicializa projeto |
| `/banca:status` | Estado atual |
| `/banca:context` | Context pack para LLM |
| `/banca:auditar` | Auditoria 4 eixos + nota |
| `/banca:corrigir` | Aplica correções + guardrails |
| `/banca:refs` | Valida referências (MCP→REST→cache) |
| `/banca:ia` | Risco IA (regex) |
| `/banca:plagio` | Parse CopySpider |
| `/banca:loop` | Loop correção contínua |
| `/banca:snapshot` | Snapshot direcionado |
| `/banca:restore` | Restaura de snapshot |
| `/banca:compile` | Compila LaTeX |
| `/banca:checklist` | Checklist entrega |
| `/banca:validate` | Valida project.json |
| `/banca:contract` | Contrato pós-correção |
