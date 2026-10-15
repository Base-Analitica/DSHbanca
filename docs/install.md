# Instalação

## Pré-requisitos
- OpenCode >= 1.x
- Node.js >= 18 ou Bun >= 1.x
- LaTeX: TeX Live com lualatex (opcional)

> ⚠️ **PENDENTE**: o pacote `@opencode/banca` ainda **não está publicado no npm**.  
> O `package.json` marca `"private": true`. As instruções de instalação via npm/bun abaixo são **planos futuros, não instruções validadas**.

```json
// opencode.json
{
  "plugin": ["@opencode/banca"]
}
```

```bash
# Para instalação de desenvolvimento local (não publicado):
git clone https://github.com/Base-Analitica/DSHbanca.git
cd DSHbanca
bun install
bun run build
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
