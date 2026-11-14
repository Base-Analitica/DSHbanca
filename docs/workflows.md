# Workflows

> **Delimitação histórica.** As seções abaixo preservam o desenho de fluxos do outro harness (OpenBanca/OpenCode) e **não descrevem os caminhos operacionais atuais do DSHbanca**. Os comandos `/banca:*` são referências históricas não suportadas. A documentação vigente está no [README](../README.md), na [arquitetura](architecture.md), na [instalação](installation.md) e no [guia de uso](usage.md). As exceções são as seções "Validação de Referências" e "Integração com MCPs", reconciliadas com o contrato DSH-only do HEAD `f6786df` (issue #122).

## Correção Contínua

```
/banca:loop correcao-continua
```

1. **Build Context**: carrega estado, scorecard, knowledge base
2. **Planner**: define plano de correção
3. **Snapshot**: backup do manuscrito
4. **Worker**: aplica correções
5. **Compile**: compila LaTeX
6. **Review**: revisa diff, valida contrato
7. **Verify**: scripts determinísticos
8. **Decide**: target atingido? → fim. Não? → próxima iteração
9. **Memory**: atualiza scorecard e histórico

## Auditoria Manual

```
/banca:auditar
```

Gera relatório completo sem editar nada.

## Validação de Referências

O comando `/banca:refs` pertence ao harness histórico. A ferramenta atual é [`banca_refs`](../src/tools/banca_refs.ts), com o seguinte contrato:

1. Lê o `.bib` configurado em `manuscript.bib` e faz parsing BibTeX local e determinístico ([gramática suportada](bibtex-parser-grammar.md)); erro de parsing retorna `bib parse error: ...` antes de qualquer resolução e sem gravar relatório.
2. Reutiliza evidência de `.banca/cache/refs.json` por chave exata e por DOI (case-insensitive).
3. Sem resultado positivo no cache, marca a referência como `bloqueada` (provider `none`, erro `external_transport_blocked`); não há consulta MCP, REST ou rede nesse caminho.
4. Grava relatório em `.banca/reports/refs-<timestamp>.md`. Bloqueadas ficam fora da média (média `N/A` se todas) e o resultado pode ser parcial; `bloqueada` não é `nao_encontrada` nem prova de referência falsa.

O resultado é evidência local: não constitui validação externa nem atestado de existência da publicação. Para interpretar cada situação, consulte o [guia de uso](usage.md) e o [troubleshooting](troubleshooting.md).

## Triagem de IA

```
/banca:ia
```

Scan heurístico de padrões de IA. Complementar com ensemble Python.

## Integração com MCPs

No DSHbanca atual, MCPs e integrações com provedores externos pertencem ao **DSH**, único harness do projeto; o plugin não configura, não registra e não inicia cliente MCP. A configuração `opencode.json` é legado histórico do outro harness, **não suportado**, e não deve ser tratada como caminho ativo — o mesmo vale para a lista de MCPs "recomendados" do protótipo (crossref-academic, pubmed, semantic-scholar).

Sem provedor nativo de referências no DSH observado (`0.2.0-rc.2`), `banca_refs` reutiliza apenas o cache local e bloqueia a validação externa; não há fallback REST nem auto-registro de MCP. Consulte [MCPs e integrações externas](mcps.md) e a seção de referências do [guia de uso](usage.md).
