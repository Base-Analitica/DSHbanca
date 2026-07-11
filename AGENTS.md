# Instruções para Agentes

Estas regras se aplicam a qualquer agente que revise código, crie issues, implemente correções ou altere o backlog do OpenBanca.

## Antes de agir

1. Leia `docs/ai-review-protocol.md`.
2. Leia `docs/issue-labeling-policy.md` antes de criar, editar, priorizar ou fechar issues.
3. Consulte `.github/labels.yml`; ele é a fonte de verdade dos labels permitidos.
4. Avalie apenas o estado real do código e da documentação. Não trate intenção, comentários ou arquivos copiados como prova de funcionamento.
5. Quando a tarefa depender do OpenCode no Jules, leia `docs/jules-opencode-environment.md` e execute o preflight documentado antes de testar.
6. Antes de aplicar ou remover o label `jules`, leia `docs/jules-dispatch-protocol.md`.

## Labels obrigatórios

Todo issue aberto deve possuir:

- exatamente um tipo: `bug`, `enhancement` ou `documentation`;
- exatamente uma prioridade: `priority:p0` a `priority:p3`;
- uma ou duas áreas `area:*`;
- labels operacionais somente quando seus critérios forem atendidos;
- o label de automação `jules` somente quando o protocolo de despacho estiver integralmente atendido.

Não invente labels.

Não altere prioridade silenciosamente. Qualquer mudança de prioridade deve ser justificada em comentário com evidência e impacto residual.

## Limites de autonomia

- `agent:ready`: o trabalho pode ser executado sem nova decisão de produto.
- `agent:blocked`: não implemente até o bloqueio documentado ser removido.
- `needs:human-decision`: investigue e proponha opções, mas não escolha silenciosamente pela pessoa responsável.
- `needs:e2e`: não feche o issue sem evidência da validação real solicitada.
- `jules`: gatilho de execução, não sinal de prontidão; não aplicar sem `agent:ready` nem manter diante de bloqueio ou decisão pendente.

## Despacho ao Jules

O label `jules` inicia uma tarefa automática do Google Jules a partir da issue. Antes de aplicá-lo:

- confirme que a issue está corretamente triada e possui `agent:ready`;
- confirme que não possui `agent:blocked` nem `needs:human-decision`;
- verifique que não existe tarefa do Jules ou PR aberta já vinculada;
- registre um contrato de tarefa completo, com evidência, escopo, critérios, testes, riscos, branch-base e destino da PR;
- use `master` como branch-base por padrão; PR empilhada exige autorização humana explícita e base exata;
- não use o label para correções de uma PR existente; nesse caso, instrua `@jules` na própria PR;
- remova o label se os pré-requisitos deixarem de ser verdadeiros.

Consulte `docs/jules-dispatch-protocol.md` para o fluxo completo.

## Testes com OpenCode no Jules

O Initial Setup do Jules disponibiliza o binário do OpenCode para testes de integração, mas cada tarefa deve confirmar o ambiente atual antes de usá-lo.

Regras obrigatórias:

- execute o preflight para resolver `OPENCODE_BIN` e use `"$OPENCODE_BIN" --version` no início da tarefa;
- registre branch e SHA efetivamente testados;
- não trate a versão histórica documentada como garantia da versão atual;
- use projeto temporário para testes diagnósticos quando possível;
- não reinstale o OpenCode dentro da tarefa quando o problema for ausência do snapshot; classifique como falha de ambiente;
- não use `OPENCODE_API_KEY` em testes que não dependem de modelo;
- nunca imprima, versione ou grave credenciais em logs;
- diferencie claramente teste do instalador, teste do parser/OpenCode e teste comportamental com LLM;
- não declare descoberta de skills aprovada quando a inicialização tiver falhado antes da listagem.

Consulte `docs/jules-opencode-environment.md` para o procedimento completo e a evidência histórica.

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
