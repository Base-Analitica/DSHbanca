# MCPs

O plugin `@opencode/banca` **não empacota nem configura MCPs**. Ele apenas consome MCPs já configurados no seu `opencode.json`.

## MCPs Recomendados

| MCP | Finalidade | Obrigatório? |
|-----|------------|-------------|
| `crossref-academic` | Validação de referências, DOIs | Sim, para `/banca:refs` completo |
| `semantic-scholar` | Citações, relevância acadêmica | Recomendado |
| `pubmed` | Artigos biomédicos | Se aplicável |
| `openalex` | Universidades, autores | Opcional |

## Exemplo de Configuração

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
