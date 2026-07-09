# Solução de Problemas

## Problemas Comuns

### 1. `main.tex not found`

**Causa:** O arquivo principal do manuscrito não existe no caminho especificado.

**Solução:**
1. Verifique o campo `manuscript.main` em `.banca/project.json`
2. Certifique-se de que o arquivo existe no diretório correto
3. Se o arquivo estiver em outro local, atualize a configuração

```bash
/banca:status  # Verifica configuração atual
```

### 2. `blocked — immutable`

**Causa:** Tentou editar um arquivo que está na lista de fatos imutáveis.

**Solução:**
1. Verifique `immutableFacts` em `.banca/project.json`
2. Remova o arquivo da lista (se apropriado)
3. Ou edite um arquivo diferente

### 3. `skipped — exists`

**Causa:** Projeto já foi inicializado e `--force` não foi usado.

**Solução:**
- Use `--force` para sobrescrever: `/banca:init --force`
- Ou delete `.banca/` manualmente antes de inicializar

### 4. `MCP not available`

**Causa:** MCP necessário não está configurado no OpenCode.

**Solução:**
1. Configure o MCP em `opencode.json`
2. Consulte `docs/mcps.md` para exemplos
3. Reinicie o OpenCode

### 5. `LaTeX not found`

**Causa:** LaTeX não está instalado ou não está no PATH.

**Solução:**
1. Instale TeX Live: `sudo apt install texlive-full` (Ubuntu)
2. Ou desabilite compilação em `.banca/project.json`:
   ```json
   "compile": { "enabled": false }
   ```

### 6. `Timeout exceeded`

**Causa:** MCP ou operação demorou mais que o limite configurado.

**Solução:**
1. Aumente `timeoutMs` em `.banca/project.json`
2. Verifique conectividade com MCPs
3. Reduza o tamanho do manuscrito

### 7. `Score not improving`

**Causa:** Loop de correção atingiu circuit breaker (3 iterações sem melhoria).

**Solução:**
1. Verifique `iterations.md` para histórico
2. Identifique problemas específicos na última auditoria
3. Aplique correções manuais se necessário
4. Considere reduzir `targetScore`

### 8. `Invalid config`

**Causa:** `project.json` contém valores inválidos.

**Solução:**
1. Execute `/banca:validate` para identificar erros
2. Consulte `docs/configuration.md` para formato correto
3. Corrija o JSON manualmente

## Diagnóstico

### Verificar Estado

```bash
/banca:status
```

Mostra: score atual, iterações, snapshots, configuração.

### Verificar Configuração

```bash
/banca:validate
```

Valida `project.json` e lista erros.

### Verificar Referências

```bash
/banca:refs
```

Gera certidão de referências com status de cada uma.

### Verificar IA

```bash
/banca:ia
```

Detecta padrões de IA no texto.

## Validação do Plugin

Para verificar se o plugin está funcionando corretamente:

1. **Inicialização**: `/banca:init` deve criar `.banca/` e `.opencode/`
2. **Auditoria**: `/banca:auditar` deve gerar relatório com 4 eixos
3. **Correção**: `/banca:corrigir` deve aplicar correções (ou bloquear se imutável)
4. **Status**: `/banca:status` deve mostrar estado atual

Se algum passo falhar, verifique:
- Se o OpenCode está rodando
- Se o plugin está instalado corretamente
- Se há erros no console do OpenCode
- Se os MCPs estão configurados (se necessário)

## Logs

O plugin não gera logs persistentes. Para diagnóstico:

1. Verifique o console do OpenCode
2. Use `/banca:status` para estado atual
3. Consulte `.banca/reports/` para relatórios anteriores
4. Verifique `.banca/state.json` para histórico de iterações

## Suporte

Se o problema persistir:

1. Consulte esta documentação
2. Abra uma issue no GitHub com:
   - Descrição do problema
   - Passos para reproduzir
   - Output do `/banca:status`
   - Versão do OpenCode e Node.js/Bun
