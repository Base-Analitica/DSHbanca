# Guia de Uso

## Visão Geral

O OpenBanca fornece 15 ferramentas que cobrem o ciclo completo de gestão de trabalhos acadêmicos:

1. **Inicialização**: Configurar o projeto
2. **Auditoria**: Avaliar qualidade em 4 eixos
3. **Correção**: Aplicar melhorias com proteção
4. **Validação**: Verificar referências e estrutura
5. **Compilação**: Gerar PDF via LaTeX
6. **Monitoramento**: Acompanhar progresso

## Fluxo Básico

```
/banca:init → /banca:auditar → /banca:corrigir → /banca:compile → /banca:status
```

## Comandos Detalhados

### `/banca:init`

Inicializa o projeto criando `.banca/` e `.opencode/`.

```bash
/banca:init
```

**Parâmetros opcionais:**
- `projectRoot`: Diretório raiz do projeto (padrão: cwd)
- `force`: Sobrescrever configuração existente

**Saída esperada (aproximada/dinâmica):**
```
✓ .banca/ + config + state
✓ X assets installed
```

### `/banca:auditar`

Executa auditoria nos 4 eixos e gera nota integrada.

```bash
/banca:auditar
```

**Parâmetros opcionais:**
- `projectRoot`: Diretório raiz do projeto
- `save`: Salvar relatório em `.banca/reports/`

**Saída esperada:**
```
## AUDIT RESULT
ABNT:       7.0  (3 findings)
Citações:   6.5  (2 findings)
Conteúdo:   8.0  (1 findings)
Estilo:     7.5  (2 findings)
---
Média: 7.25
Trava(s): >30%_paragrafos_sem_citacao_4.0
**Final: 4.0**
✗ REPROVADO
```

### `/banca:corrigir`

Aplica correções ao manuscrito com guardrails.

```bash
/banca:corrigir
```

**Parâmetros:**
- `projectRoot`: Diretório raiz do projeto
- `corrections`: Array de correções `[{file, oldText, newText}]`
- `skipSnapshot`: Pular snapshot (não recomendado)

**Guardrails:**
- Bloqueia correções em arquivos imutáveis (`immutableFacts`)
- Bloqueia correções em caminhos protegidos (`protectedPaths`)
- Cria snapshot antes de aplicar (a menos que `skipSnapshot=true`)

### `/banca:refs`

Valida referências bibliográficas via cadeia MCP → REST → cache.

```bash
/banca:refs
```

**Parâmetros opcionais:**
- `projectRoot`: Diretório raiz do projeto

**Saída esperada:**
Gera "certidão de referências" com status de cada referência. Se o MCP não estiver habilitado, a saída conterá o aviso: `MCP não habilitado, validação segue por fallback.`

### `/banca:ia`

Detecta padrões heurísticos de IA no texto.

```bash
/banca:ia
```

**Parâmetros:**
- `projectRoot`: Diretório raiz do projeto
- `forceRegex`: Forçar uso de regex (padrão)

**Saída esperada:**
```
risk=medium patterns=5 files=3
```

### `/banca:plagio`

Parseia o relatório do CopySpider (HTML ou PDF), classifica o nível de similaridade por severidade e mapeia para o manuscrito.

```bash
/banca:plagio --reportPath <caminho>
```

**Parâmetros:**
- `reportPath`: Caminho para o relatório CopySpider (HTML ou PDF). Se relativo, resolvido no `projectRoot`. Se absoluto, deve residir estritamente dentro do `projectRoot`.
- `projectRoot`: Diretório raiz do projeto (opcional).

**Saída esperada:**
Gera um relatório de plágio detalhado listando fontes suspeitas sob as categorias ENTREVISTAR, REESCREVER e PULAR.

### `/banca:loop`

Executa etapa assistida de preparação do loop de correção.

```bash
/banca:loop correcao-continua
```

**Comportamento:**
Avalia a meta de nota integrada com base nas citações, cria um snapshot de segurança automático e gera um relatório com os próximos passos recomendados. O loop é **preparatório/assistido**, exigindo que o usuário ou o agente orquestrador execute manualmente `/banca:auditar` e `/banca:corrigir` sequencialmente. Não realiza alterações de arquivos nem compilação de forma autônoma.

**Circuit breaker:** Interrompe a iteração se detectar estagnação (3 iterações seguidas com a mesma nota) ou oscilação de notas.

### `/banca:snapshot`

Cria snapshot do estado atual do manuscrito.

```bash
/banca:snapshot
```

### `/banca:restore`

Restaura o projeto a partir de um snapshot. Por padrão, opera de forma segura executando apenas um dry-run.

```bash
/banca:restore
```

**Parâmetros opcionais:**
- `snapshotId`: ID ou label do snapshot a ser restaurado. Se ausente, lista os snapshots disponíveis.
- `confirm`: Se `true`, realiza a restauração de fato; caso contrário, realiza dry-run de simulação.
- `projectRoot`: Diretório raiz do projeto.

**Segurança:**
- Quando executado com `confirm: true`, cria automaticamente um snapshot de backup `pre-restore-<timestamp>` antes de alterar qualquer arquivo.
- Restaura apenas os arquivos correspondentes à configuração real do manuscrito (usando `resolveManuscriptPaths()`).

### `/banca:compile`

Compila o manuscrito LaTeX.

```bash
/banca:compile
```

**Requer:** LaTeX instalado (lualatex, xelatex ou pdflatex).

### `/banca:checklist`

Gera checklist de entrega.

```bash
/banca:checklist
```

### `/banca:validate`

Valida o arquivo `project.json`.

```bash
/banca:validate
```

### `/banca:contract`

Gera contrato pós-correção.

```bash
/banca:contract
```

### `/banca:context`

Gera context pack para LLM.

```bash
/banca:context
```

### `/banca:status`

Mostra estado atual do projeto.

```bash
/banca:status
```

## Exemplo Prático: Workflow Completo

### 1. Inicializar projeto

```bash
/banca:init
```

### 2. Escrever o manuscrito

Escreva seu `main.tex` e capítulos em `capitulos/`.

### 3. Rodar auditoria

```bash
/banca:auditar
```

Anote a nota e os problemas encontrados.

### 4. Corrigir problemas

```bash
/banca:corrigir
```

Aplique as correções sugeridas pela auditoria.

### 5. Compilar

```bash
/banca:compile
```

Gere o PDF.

### 6. Verificar progresso

```bash
/banca:status
```

Repita passos 3-6 até atingir a nota desejada.

## Erros Comuns

| Erro | Causa | Solução |
|------|-------|---------|
| `main.tex not found` | Arquivo não existe | Verifique `manuscript.main` em `project.json` |
| `blocked — immutable` | Tentou editar arquivo imutável | Remova do `immutableFacts` ou edite outro arquivo |
| `skipped — exists` | Projeto já inicializado | Use `--force` para sobrescrever |
| `MCP not available` | MCP não configurado | Configure o MCP em `opencode.json` |
| `LaTeX not found` | LaTeX não instalado | Instale TeX Live ou desabilite compilação |
