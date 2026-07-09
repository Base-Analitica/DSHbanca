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
> export OPENBANCA_ENABLE_CROSSREF_MCP=1
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
| `bun install` | `COBERTO POR TESTE LOCAL` \| `NÃO VALIDADO EM CI` | Dependências resolvidas com sucesso localmente |
| `bun run build` (tsc) | `COBERTO POR TESTE LOCAL` \| `NÃO VALIDADO EM CI` | Compilação TypeScript executada com sucesso localmente |
| `npm install @opencode/banca` | `NÃO IMPLEMENTADO` \| `PENDENTE` | Pacote ainda não publicado no npm (`private: true`) |
| `bun add @opencode/banca` | `NÃO IMPLEMENTADO` \| `PENDENTE` | Pacote ainda não publicado no npm (`private: true`) |
| `/banca:init` | `IMPLEMENTADO` \| `COBERTO POR TESTE LOCAL` \| `NÃO VALIDADO EM OPENCODE` | Requer teste real no OpenCode |
| `/banca:status` | `IMPLEMENTADO` \| `COBERTO POR TESTE LOCAL` \| `NÃO VALIDADO EM OPENCODE` | Requer teste real no OpenCode |
| `/banca:auditar` | `IMPLEMENTADO` \| `COBERTO POR TESTE LOCAL` \| `NÃO VALIDADO EM OPENCODE` | Requer teste real no OpenCode |
| `/banca:corrigir` | `IMPLEMENTADO` \| `COBERTO POR TESTE LOCAL` \| `NÃO VALIDADO EM OPENCODE` | Requer teste real no OpenCode |
| `/banca:refs` | `IMPLEMENTADO` \| `COBERTO POR TESTE LOCAL` \| `NÃO VALIDADO COM MCP REAL` | Requer MCP real configurado e OpenCode |
| `/banca:ia` | `IMPLEMENTADO` \| `COBERTO POR TESTE LOCAL` \| `NÃO VALIDADO EM OPENCODE` | Requer teste real no OpenCode |
| `/banca:compile` | `IMPLEMENTADO` \| `COBERTO POR TESTE LOCAL` \| `NÃO VALIDADO COM LATEX REAL` | Requer LaTeX real e OpenCode |
| `/banca:loop` | `IMPLEMENTADO` \| `COBERTO POR TESTE LOCAL` \| `NÃO VALIDADO EM OPENCODE` | Requer teste real no OpenCode |
| `bun test` | `COBERTO POR TESTE LOCAL` \| `NÃO VALIDADO EM CI` | Testes unitários/integração executados com sucesso localmente |
| `tsc --noEmit` | `COBERTO POR TESTE LOCAL` \| `NÃO VALIDADO EM CI` | Typecheck executado com sucesso localmente |

## Troubleshooting

Consulte `docs/troubleshooting.md` para problemas comuns e soluções.
