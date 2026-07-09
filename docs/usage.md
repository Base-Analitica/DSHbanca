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

**Saída esperada:**
```
✓ .banca/ + config + state
✓ 12 assets installed
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
- `forceRefresh`: Forçar atualização do cache

**Saída esperada:**
Gera "certidão de referências" com status de cada referência.

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

### `/banca:loop`

Executa loop de correção contínua.

```bash
/banca:loop correcao-continua
```

**Fluxo do loop:**
1. Build Context: carrega estado, scorecard, knowledge base
2. Planner: define plano de correção
3. Snapshot: backup do manuscrito
4. Worker: aplica correções
5. Compile: compila LaTeX
6. Review: revisa diff, valida contrato
7. Verify: scripts determinísticos
8. Decide: target atingido? → fim. Não? → próxima iteração
9. Memory: atualiza scorecard e histórico

**Circuit breaker:** Para se detectar estagnação (3 iterações sem melhoria).

### `/banca:snapshot`

Cria snapshot do estado atual do manuscrito.

```bash
/banca:snapshot
```

### `/banca:restore`

Restaura de um snapshot anterior.

```bash
/banca:restore
```

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
