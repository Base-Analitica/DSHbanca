# Workflows

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

```
/banca:refs
```

Gera certidão de referências. Requer MCPs configurados.

## Triagem de IA

```
/banca:ia
```

Scan heurístico de padrões de IA. Complementar com ensemble Python.

## Integração com MCPs

O plugin usa MCPs já configurados no seu `opencode.json`:

- **crossref-academic**: validação de referências
- **pubmed**: verificação de artigos PubMed
- **semantic-scholar**: citações e relevância

Configure-os globalmente ou no projeto — o plugin apenas consome.
