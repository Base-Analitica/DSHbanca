# Configuração

`.banca/project.json` controla o comportamento.

```json
{
  "version": 1,
  "manuscript": {
    "format": "latex",
    "root": ".",
    "main": "main.tex",
    "bib": "referencias.bib",
    "chapters": ["capitulos/*.tex"],
    "outputDir": "trabalhos"
  },
  "compile": {
    "enabled": true,
    "command": ["lualatex", "bibtex", "lualatex", "lualatex"]
  },
  "allowedPaths": ["**/*.tex", "**/*.bib", "**/*.md"],
  "protectedPaths": ["dados/**", ".banca/snapshots/**", ".git/**"],
  "immutableFacts": ["dados/**"],
  "externalDependencies": [
    "ficha catalográfica: aguardando CRB oficial da biblioteca"
  ],
  "rubricProfile": "banca-rigorosa",
  "targetScore": 9.0,
  "providers": {
    "references": {
      "primary": "mcp:crossref-academic",
      "fallbacks": ["rest:crossref", "cache"],
      "timeoutMs": 20000
    }
  },
  "mcp": {
    "crossrefAcademicEnabled": true
  }
}
```

## Campos

| Campo | Descrição |
|-------|-----------|
| `manuscript` | Localização do manuscrito |
| `compile` | Comando de compilação LaTeX |
| `allowedPaths` | Padrões editáveis |
| `protectedPaths` | Padrões NÃO editáveis |
| `immutableFacts` | Fatos imutáveis (bloqueiam correção) |
| `externalDependencies` | Dependências externas (não penalizáveis) |
| `rubricProfile` | Perfil de rubrica |
| `targetScore` | Nota alvo |
| `providers.references` | Cadeia de provedores: MCP → REST → cache |
| `mcp.crossrefAcademicEnabled` | Auto-registra MCP crossref-academic |

## Migração automática

Configs legado (v0, sem `providers`) são migradas automaticamente no `loadConfig`. Nenhuma ação manual necessária.
