# Solução de Problemas

> **Página parcialmente histórica.** As menções a `/banca:*`, `opencode.json` e OpenCode nesta página são registro do outro harness (OpenBanca/OpenCode), **legado não suportado**; as ferramentas atuais são as tools nativas do DSHbanca no DSH, e não há slash commands nem CLI do host a recomendar. Os itens de referências, timeout e diagnóstico foram reconciliados com o contrato do HEAD `f6786df` (issue #122); nos demais itens, consulte o [guia de uso](usage.md), a [arquitetura](architecture.md) e [MCPs e integrações externas](mcps.md).

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

### 4. Referência bloqueada / `external_transport_blocked`

**Causa:** A ferramenta de referências não encontrou resultado positivo no cache local (`.banca/cache/refs.json`) e o DSH observado (`0.2.0-rc.2`) não oferece provedor nativo de referências. O caminho atual não tenta rede, REST ou MCP próprio; por isso a referência fica `bloqueada` (provider `none`, erro `external_transport_blocked`).

**Como interpretar:** `bloqueada` **não** é `nao_encontrada`, não entra na média e **não** prova que a referência seja falsa. Se houver resultado positivo em cache, ele é reutilizado como evidência armazenada — o que não comprova consulta externa atual nem autenticidade.

**O que não fazer:** não configure `opencode.json` (legado histórico do outro harness, não suportado), não ative `mcp.crossrefAcademicEnabled`, não use `OPENBANCA_ENABLE_CROSSREF_MCP`/`DSHBANCA_ENABLE_CROSSREF_MCP` e não aumente `providers.references.timeoutMs` esperando "desbloquear" referências: esses campos são preservados por compatibilidade e não habilitam transporte. Validação externa depende do DSH, não do plugin.

Veja [MCPs e integrações externas](mcps.md) e a interpretação por cenário no [guia de uso](usage.md).

### 5. `LaTeX not found`

**Causa:** LaTeX não está instalado ou não está no PATH.

**Solução:**
1. Instale TeX Live: `sudo apt install texlive-full` (Ubuntu)
2. Ou desabilite compilação em `.banca/project.json`:
   ```json
   { "compile": { "enabled": false } }
   ```

### 6. `Timeout exceeded`

**Causa:** No fluxo DSH-only atual, `providers.references.timeoutMs` (default 20000) é campo legado preservado por `loadConfig` e **não** é consultado por `banca_refs`; ele não governa o bloqueio de referências e não habilita MCP. A causa histórica "MCP demorou mais que o limite configurado" pertence ao outro harness e não é caminho operacional.

**Solução:** não aumente `timeoutMs` para tentar desbloquear referências; interprete o bloqueio conforme o item 4. Se a demora ocorreu em outra etapa (por exemplo, compilação LaTeX), registre comando, duração e saída; o schema atual não expõe timeout configurável para essas etapas. Para o estado do projeto, consulte o [guia de uso](usage.md).

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
2. Consulte [configuration.md](configuration.md) para o formato correto
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

A ferramenta de referências do DSHbanca é [`banca_refs`](../src/tools/banca_refs.ts); o comando `/banca:refs` é histórico, não suportado. Interprete as respostas possíveis:

| Resposta | Significado | Observação |
|---|---|---|
| `bib parse error: ...` | O `.bib` configurado é malformado ou usa construção não suportada | Parsing tudo ou nada; não grava relatório de validação |
| `bib not found: <caminho>` | O arquivo `.bib` configurado não existe no caminho resolvido | Verifique `manuscript.bib` em `.banca/project.json` |
| `no entries found in bib file` | Sintaxe válida, sem entradas bibliográficas | Não é erro de parsing |
| Resultado positivo em cache | Evidência armazenada reutilizada | Não comprova consulta externa atual nem autenticidade |
| `bloqueada` / `external_transport_blocked` / `Blocked` | Sem cache positivo e sem provedor nativo no DSH observado | Fora da média; não é `nao_encontrada` nem prova de referência falsa |
| `Partial evaluation: E/N evaluated (B blocked)` | Avaliação parcial | Só as avaliadas entram na média |

O relatório fica em `.banca/reports/refs-<timestamp>.md` e registra providers, evidências e limitações. Se todas as referências estiverem bloqueadas, a média é `N/A` e o veredito informa que nenhuma referência pôde ser avaliada. Veja a [gramática do parser](bibtex-parser-grammar.md) e a interpretação por cenário no [guia de uso](usage.md).

Não configure `opencode.json` (legado histórico não suportado), não ative `mcp.crossrefAcademicEnabled` nem flags `*_ENABLE_CROSSREF_MCP` e não aumente `providers.references.timeoutMs` esperando desbloquear referências: esses campos não habilitam transporte. Validação externa pertence ao DSH.

### Verificar IA

```bash
/banca:ia
```

Detecta padrões de IA no texto.

## Validação do Plugin (histórico OpenCode)

> **Instruções históricas não suportadas.** A sequência abaixo descreve o harness legado (OpenCode) e os comandos `/banca:*`; ela não é o caminho operacional atual do DSHbanca. As ferramentas atuais são as tools nativas `banca_*` registradas no DSH, cuja disponibilidade operacional ainda exige E2E DSH no SHA final.

No desenho histórico, verificava-se:

1. **Inicialização**: `/banca:init` criava `.banca/` e `.opencode/`
2. **Auditoria**: `/banca:auditar` gerava relatório com 4 eixos
3. **Correção**: `/banca:corrigir` aplicava correções (ou bloqueava se imutável)
4. **Status**: `/banca:status` mostrava o estado atual

Para o DSHbanca atual, o diagnóstico disponível é local e não substitui E2E DSH: verifique `.banca/reports/` (relatórios gerados), `.banca/state.json` (estado persistido) e a saída das próprias tools. O plugin não gera logs persistentes.

## Logs

O plugin não gera logs persistentes. No DSHbanca atual, o diagnóstico é local:

1. Consulte `.banca/reports/` para relatórios gerados, inclusive `refs-<timestamp>.md`
2. Verifique `.banca/state.json` para o estado persistido
3. Consulte a saída da tool de status (`banca_status`) para o estado atual do projeto

A menção histórica ao console do OpenCode e a `/banca:status` pertence ao outro harness e não é caminho operacional suportado. Esta documentação não instrui sobre logs do DSH.

## Suporte

Se o problema persistir:

1. Consulte esta documentação e o [guia de uso](usage.md)
2. Abra uma issue no GitHub com:
   - descrição do problema;
   - passos para reproduzir;
   - comando executado, saída e exit code, quando houver;
   - versão do DSH/Cordis, SHA do repositório e versão do Bun.

> A referência histórica a `/banca:status`, ao console do OpenCode e às versões do OpenCode/Node pertence ao harness legado e não é suportada no DSHbanca atual.
