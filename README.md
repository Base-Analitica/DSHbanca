# DSHbanca

Plugin DSH (DeepSeek Harness) e OpenCode para gestão, auditoria e correção de trabalhos acadêmicos (monografias, dissertações, TCCs).

Adaptado a partir do projeto original `OpenBanca` da organização **Base Analítica** para funcionamento nativo no ecossistema **dsh**.

## Objetivo

O DSHbanca resolve o problema de qualidade em trabalhos acadêmicos ao fornecer um sistema automatizado de auditoria em 4 eixos (ABNT, Citações, Conteúdo, Estilo), correção contínua com guardrails, validação de referências via MCPs e detecção de padrões de IA.

O plugin se integra ao **dsh** (DeepSeek Harness) via Cordis plugin loader e `ctx.skills`/`ctx.tools`, além de suportar OpenCode como coleção de ferramentas, agentes e skills que executam o workflow de correção acadêmica de forma estruturada e reproduzível.

## Para quem é

- **Usuários de DSH (DeepSeek Harness)** que escrevem trabalhos acadêmicos e precisam de auditoria automatizada e skills acadêmicas
- **Usuários de OpenCode** que precisam do workflow acadêmico integrado
- **Agentes de IA** que precisam de ferramentas especializadas para revisão de textos acadêmicos
- **Desenvolvedores de workflows** que querem estender ou personalizar o processo de correção
- **Revisores de prompts/skills** que querem auditar e melhorar o bundle
- **Educadores** que querem automatizar parte da correção de trabalhos estudantis

## Estado atual

**Experimental / Protótipo (v0.1.0)** — pacote `dshbanca` em desenvolvimento local.

### Funcionalidades implementadas no código — validação externa pendente

- **Inicialização de projeto (`/banca:init`)**: `IMPLEMENTADO` | `COBERTO POR TESTE LOCAL` | `NÃO VALIDADO EM OPENCODE`
- **Auditoria em 4 eixos com nota integrada**: `IMPLEMENTADO` | `COBERTO POR TESTE LOCAL` | `NÃO VALIDADO EM OPENCODE`
- **Correção com guardrails (arquivos imutáveis)**: `IMPLEMENTADO` | `COBERTO POR TESTE LOCAL` | `NÃO VALIDADO EM OPENCODE`
- **Validação de referências (cadeia MCP → REST → cache)**: `IMPLEMENTADO` | `COBERTO POR TESTE LOCAL` | `NÃO VALIDADO COM MCP REAL`
- **Detecção heurística/python de padrões de IA**: `IMPLEMENTADO` | `COBERTO POR TESTE LOCAL` | `NÃO VALIDADO EM CI (EXECUÇÃO GITHUB PENDENTE)`
- **Loop de correção contínua com circuit breaker**: `IMPLEMENTADO` | `COBERTO POR TESTE LOCAL` | `NÃO VALIDADO EM OPENCODE`
- **Snapshots para versionamento de correções**: `IMPLEMENTADO` | `COBERTO POR TESTE LOCAL` | `NÃO VALIDADO EM OPENCODE`
- **Compilação LaTeX**: `IMPLEMENTADO` | `COBERTO POR TESTE LOCAL` | `NÃO VALIDADO COM LATEX REAL`
- **Checklist de entrega**: `IMPLEMENTADO` | `COBERTO POR TESTE LOCAL` | `NÃO VALIDADO EM OPENCODE`

### Estado de Validação Geral

- `IMPLEMENTADO`: Sim, codificado no repositório.
- `COBERTO POR TESTE LOCAL`: Sim, verificado via suíte de testes do Bun localmente.
- `NÃO VALIDADO EM CI`: O workflow do GitHub Actions existe, mas a execução no GitHub ainda é pendente.
- `NÃO VALIDADO EM OPENCODE`: O plugin e os comandos/agentes ainda não foram executados em um cliente real do OpenCode.
- `NÃO VALIDADO COM MCP REAL`: Os testes utilizam mock do protocolo MCP, o funcionamento com servidores MCP reais (ex: crossref-academic executado via uvx) não foi verificado.
- `NÃO VALIDADO COM LATEX REAL`: A lógica de compilação foi testada com comandos mock e unitários; a compilação real de documentos complexos LaTeX não foi executada de ponta a ponta pelo plugin.

### Riscos e limitações conhecidas

- Requer OpenCode >= 1.x
- Requer Node.js >= 18 ou Bun >= 1.x
- LaTeX (lualatex) é opcional mas necessário para compilação
- MCPs são consumidos, não empacotados pelo plugin
- A detecção de IA é heurística (regex), não definitiva

## Estrutura do repositório

```
.
├── README.md                    # Este arquivo
├── CHANGELOG.md                 # Histórico de mudanças
├── ROADMAP.md                   # Plano de desenvolvimento
├── CONTRIBUTING.md              # Guia de contribuição
├── SECURITY.md                  # Política de segurança
├── LICENSE_PENDING.md           # Licença (pendente)
├── .gitignore                   # Arquivos ignorados pelo Git
├── .editorconfig                # Configuração de edição
├── package.json                 # Dependências e scripts
├── tsconfig.json                # Configuração TypeScript
├── bun.lock                     # Lockfile do Bun
├── docs/                        # Documentação técnica
│   ├── overview.md              # Visão geral do projeto
│   ├── installation.md          # Guia de instalação
│   ├── usage.md                 # Guia de uso
│   ├── architecture.md          # Arquitetura do sistema
│   ├── skill-spec.md            # Especificação das skills
│   ├── ai-review-protocol.md    # Protocolo de revisão por IA
│   ├── troubleshooting.md       # Solução de problemas
│   └── decisions/               # Decisões de design
├── src/                         # Código fonte TypeScript
│   ├── index.ts                 # Entry point do plugin
│   ├── lib/                     # Bibliotecas internas
│   └── tools/                   # 15 ferramentas do plugin
├── assets/                      # Assets do OpenCode
│   ├── opencode/                # Agentes, comandos, skills
│   └── templates/               # Templates (style-guide)
├── tests/                       # Testes
├── prompts/                     # Prompts para revisão por IA
├── scripts/                     # Scripts de validação
└── .github/                     # Templates GitHub
```

## Instalação

### Pré-requisitos

- OpenCode >= 1.x
- Node.js >= 18 ou Bun >= 1.x
- LaTeX: TeX Live com lualatex (opcional, para compilação)

### Instalação via npm/bun (PENDENTE)

> ⚠️ **PENDENTE**: o pacote `@opencode/banca` ainda **não está publicado no npm**.  
> O `package.json` marca `"private": true` e `"license": "UNLICENSED"`.  
> Os comandos abaixo são **planos futuros**, não instruções validadas.

```bash
# PENDENTE: pacote ainda não publicado
npm install @opencode/banca
# ou
bun add @opencode/banca
```

### Instalação local (recomendado atualmente)

```bash
git clone https://github.com/RenyEnnos/DSHbanca.git
cd DSHbanca
bun install
bun run build
```

> NÃO VALIDADO: a instalação local com Bun foi testada apenas quanto à resolução de dependências e compilação TypeScript. O uso real com OpenCode não foi validado.

### Configuração no OpenCode

```json
// opencode.json
{
  "plugin": ["@opencode/banca"]
}
```

### Inicialização

```bash
/banca:init
```

Cria `.banca/` + `.opencode/` (agents, commands, skills, templates).

## Uso básico

### Inicializar um projeto

```bash
/banca:init
```

### Rodar uma auditoria

```bash
/banca:auditar
```

Gera relatório completo nos 4 eixos (ABNT, Citações, Conteúdo, Estilo) com nota integrada.

### Corrigir o trabalho

```bash
/banca:corrigir
```

Aplica correções com guardrails (protege arquivos imutáveis).

### Loop de correção contínua

```bash
/banca:loop correcao-continua
```

Executa etapa assistida de preparação do loop: avalia meta de nota, cria snapshot de segurança e gera relatório com próximos passos estruturados (não executa ações autônomas de correção ou compilação).

### Validar referências

```bash
/banca:refs
```

Gera certidão de referências via cadeia MCP → REST → cache.

> ⚠️ O MCP `crossref-academic` não é registrado automaticamente.  
> Para habilitar o auto-registro experimental, use `OPENBANCA_ENABLE_CROSSREF_MCP=1`.

### Verificar risco de IA

```bash
/banca:ia
```

Scan heurístico de padrões de IA no texto.

## Como revisar com IA

O repositório foi preparado para revisão por modelos de IA. Consulte a pasta `prompts/` para prompts prontos:

- `prompts/ai-reviewer-general.md` - Revisão geral do projeto
- `prompts/ai-reviewer-code.md` - Revisão de código e estrutura
- `prompts/ai-reviewer-docs.md` - Revisão de documentação
- `prompts/ai-reviewer-security.md` - Revisão de segurança

Consulte também `docs/ai-review-protocol.md` para o protocolo completo de revisão.

## Como contribuir

Consulte `CONTRIBUTING.md` para guia completo de contribuição.

## Segurança

Consulte `SECURITY.md` para política de segurança e como reportar problemas.

## Roadmap

Consulte `ROADMAP.md` para o plano de desenvolvimento.

## Licença

Licença ainda não definida. Não reutilize este projeto publicamente sem autorização do autor.

TODO: escolher uma licença apropriada (MIT, Apache-2.0, GPL-3.0 ou proprietária).

## Comandos Disponíveis

| Comando | Descrição |
|---------|-----------|
| `/banca:init` | Inicializa projeto |
| `/banca:status` | Estado atual |
| `/banca:context` | Context pack para LLM |
| `/banca:auditar` | Auditoria 4 eixos + nota |
| `/banca:corrigir` | Aplica correções + guardrails |
| `/banca:refs` | Valida referências (MCP→REST→cache) |
| `/banca:ia` | Risco IA (regex) |
| `/banca:plagio` | Parse CopySpider |
| `/banca:loop` | Etapa assistida do loop (preparatório) |
| `/banca:snapshot` | Snapshot direcionado |
| `/banca:restore` | Restaura de snapshot |
| `/banca:compile` | Compila LaTeX |
| `/banca:checklist` | Checklist entrega |
| `/banca:validate` | Valida project.json |
| `/banca:contract` | Contrato pós-correção |
