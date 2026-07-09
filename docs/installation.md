# Instalação

## Pré-requisitos

- **OpenCode** >= 1.x
- **Node.js** >= 18 ou **Bun** >= 1.x
- **LaTeX** (opcional): TeX Live com lualatex, xelatex ou pdflatex

## Instalação

### Via npm

```bash
npm install @opencode/banca
```

### Via Bun

```bash
bun add @opencode/banca
```

### Configuração no OpenCode

Adicione o plugin ao seu `opencode.json`:

```json
{
  "plugin": ["@opencode/banca"]
}
```

## Inicialização

Após instalar, inicialize o projeto:

```bash
/banca:init
```

Isso cria as seguintes estruturas:

### Diretório `.banca/`

```
.banca/
├── project.json      # Configuração do projeto
├── state.json        # Estado (score, iterações, snapshots)
├── scorecard.md      # Scorecard atual
├── iterations.md     # Histórico de iterações
├── checklist.md      # Checklist de entrega
├── knowledge.md      # Base de conhecimento
├── reports/          # Relatórios gerados
├── context/          # Context packs
├── snapshots/        # Snapshots do manuscrito
└── cache/            # Cache de referências
```

### Diretório `.opencode/`

```
.opencode/
├── agents/           # Agentes @banca-*
├── commands/         # Comandos /banca:*
├── skills/           # Skills disponíveis
└── templates/        # Templates (style-guide)
```

## MCPs (Model Context Protocol)

O plugin consome MCPs já configurados no seu `opencode.json`. MCPs recomendados:

| MCP | Finalidade | Obrigatório? |
|-----|------------|-------------|
| `crossref-academic` | Validação de referências, DOIs | Sim, para `/banca:refs` completo |
| `semantic-scholar` | Citações, relevância acadêmica | Recomendado |
| `pubmed` | Artigos biomédicos | Se aplicável |
| `openalex` | Universidades, autores | Opcional |

### Exemplo de configuração MCP

```json
{
  "mcpServers": {
    "crossref-academic": {
      "command": "node",
      "args": ["path/to/crossref-academic-mcp/index.js"]
    }
  }
}
```

Se um MCP não estiver disponível, o plugin declara limitação mas não falha.

## Validação da Instalação

Após inicializar, execute:

```bash
/banca:status
```

Isso mostra o estado atual do projeto e confirma que everything está configurado.

## Estado de Validação

| Comando | Testado? | Observação |
|---------|----------|------------|
| `npm install @opencode/banca` | SIM | Funciona normalmente |
| `bun add @opencode/banca` | SIM | Funciona normalmente |
| `/banca:init` | SIM | Cria estruturas corretamente |
| `/banca:status` | SIM | Retorna estado atual |
| `/banca:auditar` | SIM | Gera relatório completo |
| `/banca:corrigir` | SIM | Aplica correções com guardrails |
| `/banca:refs` | PARCIAL | Requer MCP configurado |
| `/banca:ia` | SIM | Detecção heurística funciona |
| `/banca:compile` | PARCIAL | Requer LaTeX instalado |
| `/banca:loop` | SIM | Loop funciona com circuit breaker |

## Troubleshooting

Consulte `docs/troubleshooting.md` para problemas comuns e soluções.
