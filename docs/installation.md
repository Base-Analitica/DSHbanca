# Instalação

## Pré-requisitos

- **OpenCode** >= 1.x
- **Node.js** >= 18 ou **Bun** >= 1.x
- **LaTeX** (opcional): TeX Live com lualatex, xelatex ou pdflatex

## Estado do Projeto

> ⚠️ **Experimental / Protótipo (v0.1.0)**
> O pacote `@opencode/banca` está marcado como `"private": true` e **não está publicado no npm**.  
> O uso atual recomendado é local, não via gerenciador de pacotes público.

## Instalação Local (recomendado)

```bash
git clone https://github.com/RenyEnnos/openbanca.git
cd openbanca
bun install
bun run build
```

> NÃO VALIDADO: a instalação local passou pela resolução de dependências e compilação TypeScript.  
> O uso real com OpenCode, a execução dos comandos `/banca:*` e integração com MCPs **ainda não foram validados**.

## Publicação Futura

A publicação no npm está planejada após a definição de licença e testes completos com OpenCode.  
Até lá, os comandos abaixo são **planos futuros, não instruções validadas**:

### Via npm (PENDENTE)

```bash
npm install @opencode/banca
```

### Via Bun (PENDENTE)

```bash
bun add @opencode/banca
```

### Configuração no OpenCode

Após instalar (local ou futuramente via npm), adicione o plugin ao seu `opencode.json`:

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

> ⚠️ O OpenBanca **não registra MCPs automaticamente** por padrão.
> Para habilitar o auto-registro experimental do `crossref-academic`, defina:
> ```bash
> export OPENBANCA_AUTO_REGISTER_CROSSREF_MCP=1
> ```
> Use apenas em ambiente controlado.

## Validação da Instalação

Após inicializar, execute:

```bash
/banca:status
```

Isso mostra o estado atual do projeto e confirma que everything está configurado.

## Estado de Validação

| Item | Status | Observação |
|------|--------|------------|
| `bun install` | VALIDADO | Dependências resolvidas com sucesso |
| `bun run build` (tsc) | VALIDADO | Compilação TypeScript executada com sucesso |
| `npm install @opencode/banca` | PENDENTE | Pacote ainda não publicado no npm |
| `bun add @opencode/banca` | PENDENTE | Pacote ainda não publicado no npm |
| `/banca:init` | NÃO VALIDADO | Requer teste real no OpenCode |
| `/banca:status` | NÃO VALIDADO | Requer teste real no OpenCode |
| `/banca:auditar` | NÃO VALIDADO | Requer teste real no OpenCode |
| `/banca:corrigir` | NÃO VALIDADO | Requer teste real no OpenCode |
| `/banca:refs` | NÃO VALIDADO | Requer MCP configurado e OpenCode |
| `/banca:ia` | NÃO VALIDADO | Requer teste real no OpenCode |
| `/banca:compile` | NÃO VALIDADO | Requer LaTeX instalado e OpenCode |
| `/banca:loop` | NÃO VALIDADO | Requer teste real no OpenCode |
| `bun test` | VALIDADO | Testes unitários executados com sucesso |
| `tsc --noEmit` | VALIDADO | Typecheck executado com sucesso |

## Troubleshooting

Consulte `docs/troubleshooting.md` para problemas comuns e soluções.
