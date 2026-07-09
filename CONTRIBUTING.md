# Contribuindo para o OpenBanca

Obrigado por interesse em contribuir com o OpenBanca! Este documento explica como participar.

## Como Abrir uma Issue

1. Verifique se a issue já existe
2. Use o template apropriado (bug report, improvement, ai review)
3. Forneça informações claras e específicas
4. Inclua passos para reproduzir (se aplicável)

### Tipos de Issue

- **Bug Report**: Reporte um problema encontrado
- **Improvement**: Sugira uma melhoria
- **AI Review**: Compartilhe resultados de revisão por IA

## Como Propor uma Melhoria

1. Abra uma issue descrevendo a melhoria
2. Explique o problema que ela resolve
3. Aguarde discussão antes de implementar
4. Após aprovação, crie um branch e PR

## Como Revisar uma Skill

1. Leia o `SKILL.md` da skill
2. Verifique se a documentação está completa
3. Teste a skill em ambiente real
4. Verifique se há guardrails adequados
5. Abra uma issue ou PR com suas observações

## Como Enviar um PR

1. Fork o repositório
2. Crie um branch para sua feature/fix
3. Implemente suas mudanças
4. Execute os testes: `bun test`
5. Execute a validação: `bun run typecheck`
6. Crie o PR com descrição clara

### Padrão de Commits

Use commits descritivos em português:

```
feat: adicionar nova tool de validação
fix: corrigir cálculo de nota integrada
docs: atualizar guia de instalação
test: adicionar testes para banca_refs
chore: atualizar dependências
```

### Estrutura do PR

```markdown
## O que foi alterado?

Descrição das mudanças.

## Por que foi alterado?

Motivo da mudança.

## Como foi testado?

Passos para testar.

## Impacto nas skills/plugins

Como a mudança afeta o plugin.

## Checklist

- [ ] Não expõe segredos
- [ ] Não quebra compatibilidade conhecida
- [ ] Documentação atualizada
- [ ] Exemplos atualizados, se necessário
- [ ] Testes/validações executados, se existirem
```

## Regras Importantes

### Não Invente Compatibilidade

Se você adicionar uma funcionalidade, documente:
- Requisitos
- Limitações
- Casos de uso

Não afirme compatibilidade que não foi testada.

### Documente Toda Mudança

Toda mudança deve ser documentada em:
- Código (comentários quando necessário)
- CHANGELOG.md
- README.md (se afetar uso)

### Não Exponha Segredos

Nunca commit:
- Tokens
- Chaves de API
- Senhas
- Caminhos locais sensíveis
- Dados pessoais

### Teste Antes de Enviar

Execute:
```bash
bun test
bun run typecheck
```

## Perguntas?

Abra uma issue com a tag `question`.
