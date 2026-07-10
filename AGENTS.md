# Instruções para Agentes

Estas regras se aplicam a qualquer agente que revise código, crie issues, implemente correções ou altere o backlog do OpenBanca.

## Antes de agir

1. Leia `docs/ai-review-protocol.md`.
2. Leia `docs/issue-labeling-policy.md` antes de criar, editar, priorizar ou fechar issues.
3. Consulte `.github/labels.yml`; ele é a fonte de verdade dos labels permitidos.
4. Avalie apenas o estado real do código e da documentação. Não trate intenção, comentários ou arquivos copiados como prova de funcionamento.

## Labels obrigatórios

Todo issue aberto deve possuir:

- exatamente um tipo: `bug`, `enhancement` ou `documentation`;
- exatamente uma prioridade: `priority:p0` a `priority:p3`;
- uma ou duas áreas `area:*`;
- labels operacionais somente quando seus critérios forem atendidos.

Não invente labels.

Não altere prioridade silenciosamente. Qualquer mudança de prioridade deve ser justificada em comentário com evidência e impacto residual.

## Limites de autonomia

- `agent:ready`: o trabalho pode ser executado sem nova decisão de produto.
- `agent:blocked`: não implemente até o bloqueio documentado ser removido.
- `needs:human-decision`: investigue e proponha opções, mas não escolha silenciosamente pela pessoa responsável.
- `needs:e2e`: não feche o issue sem evidência da validação real solicitada.

## Escrita e segurança

- Não modifique arquivos fora do escopo do issue.
- Não faça push direto na branch padrão quando uma branch e PR forem apropriados.
- Não execute restore, rollback, publicação, release ou migração destrutiva sem política explícita.
- Não exponha tokens, caminhos privados, manuscritos ou conteúdo sensível em issues e logs.
- Não declare testes, integração com OpenCode, MCP ou compilação como aprovados sem execução comprovada.

## Fechamento de issues

Ao fechar um issue, registre:

- o que mudou;
- commit ou PR relevante;
- testes executados;
- limitações e itens não validados;
- acompanhamento necessário.

Se apenas parte do problema foi resolvida, mantenha o issue aberto ou crie um issue de acompanhamento claramente vinculado.
