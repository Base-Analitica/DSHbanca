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
  "targetScore": 9.0
}
```

Este exemplo omite os campos opcionais `providers` e `mcp`, preservados apenas por compatibilidade. Quando ausentes, `loadConfig` aplica os defaults descritos em [Campos legados preservados](#campos-legados-preservados), sem efeito sobre `banca_refs`.

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
| `providers.references` | Campo legado preservado por compatibilidade (`primary`, `fallbacks`, `timeoutMs`); não habilita transporte em `banca_refs` |
| `mcp.crossrefAcademicEnabled` | Campo legado preservado por compatibilidade (default `false`); não registra MCP nem inicia processo |

## Campos legados preservados

`loadConfig` preserva e normaliza esses campos, inclusive na migração de configurações v0, mas eles **não** habilitam transporte em `banca_refs`:

- `providers.references` — `primary` (default `mcp:crossref-academic`), `fallbacks` (default `["rest:crossref", "cache"]`) e `timeoutMs` (default `20000`). São valores preservados; não são consultados pelo fluxo de `banca_refs`/`resolveRef`.
- `mcp.crossrefAcademicEnabled` — default `false`. Preservado e migrado de configurações v0; não registra MCP, não inicia processo e não aciona fallback REST.

`getMcpCommand()` existe em [`src/lib/config.ts`](../src/lib/config.ts) como helper legado, sem call site no fluxo de `banca_refs`; `OPENBANCA_ENABLE_CROSSREF_MCP` pertence a esse helper e não desbloqueia a ferramenta. Nesta base DSH-only, o cache local (`.banca/cache/refs.json`) é a evidência de validação disponível e referências sem resultado positivo ficam `bloqueada` com `external_transport_blocked`; MCP, rede e lifecycle de integrações pertencem ao DSH. Não configure outro harness, MCP próprio ou flags legadas esperando obter validação externa (ver [como interpretar `banca_refs`](usage.md#como-interpretar-banca_refs)).

## Migração automática

Configs legado (v0, sem `providers`) são migradas automaticamente no `loadConfig`. Nenhuma ação manual necessária.
