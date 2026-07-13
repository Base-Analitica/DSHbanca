# Instruções para Agentes

Estas regras se aplicam a qualquer agente que revise código, crie issues, implemente correções ou altere o backlog do OpenBanca.

## Antes de agir

1. Leia `docs/ai-review-protocol.md`.
2. Leia `docs/issue-labeling-policy.md` antes de criar, editar, priorizar ou fechar issues.
3. Consulte `.github/labels.yml`; ele é a fonte de verdade dos labels permitidos.
4. Avalie apenas o estado real do código e da documentação. Não trate intenção, comentários ou arquivos copiados como prova de funcionamento.
5. Quando a tarefa depender do OpenCode no Jules, leia `docs/jules-opencode-environment.md` e execute o preflight documentado antes de testar.
6. Antes de aplicar ou remover o label `jules`, leia `docs/jules-dispatch-protocol.md`.
7. Antes de preparar qualquer tarefa para o Jules, leia `docs/jules-task-sizing.md` e confirme que a issue é uma folha pequena e verificável.
8. Antes de codar com um agente de IA no terminal, leia `docs/terminal-agent-workflow.md` e siga o preflight, o fluxo de branch, os testes e o relatório de evidência ali definidos.

## Invariante arquitetural: OpenCode é o harness

Conforme a decisão vinculante da [issue #64](https://github.com/RenyEnnos/openbanca/issues/64), o OpenBanca é um plugin/camada de domínio acadêmico executado sobre o OpenCode. O OpenCode é o harness e fornece:

- modelos, autenticação e integração geral com provedores;
- sessões, histórico e contexto conversacional geral;
- agents, subagents, tool loop e delegação;
- commands e permissões;
- configuração e lifecycle de MCPs.

O OpenBanca é responsável somente pela camada acadêmica:

- representação canônica do manuscrito e segmentação/cobertura por lotes;
- rubricas e perfis institucionais;
- findings estruturados, proveniência e fingerprints;
- validações acadêmicas determinísticas e guardrails de correção;
- snapshots, changesets e estado específico do projeto;
- tools acadêmicas consumidas pelo OpenCode.

### Preflight host-first obrigatório

Antes de criar qualquer cliente, adapter, runtime, servidor, subprocesso permanente ou integração, o agente deve responder no relatório da tarefa:

1. O OpenCode já fornece essa capacidade?
2. Qual API, SDK, configuração, agent, skill, command, tool ou integração do OpenCode foi verificada?
3. Qual lacuna concreta do host permanece?
4. Por que a implementação pertence especificamente ao domínio acadêmico?
5. Como o componente será impedido de evoluir para infraestrutura geral?
6. Qual evidência E2E em OpenCode real comprova a necessidade?
7. Qual será o plano de remoção ou migração se o OpenCode passar a fornecer a capacidade?

Sem uma lacuna concreta e documentada, a implementação deve usar o OpenCode. O relatório deve ainda identificar, para cada integração, o proprietário do lifecycle, ambiente, credenciais, fallback e evidência E2E.

### MCPs, agents e modelos

MCPs devem ser configurados e gerenciados pelo OpenCode por padrão. Processo, autenticação, lifecycle, observabilidade e chamadas genéricas pertencem ao host. O OpenBanca pode implementar apenas comportamento acadêmico sobre resultados, como matching de referências, normalização de metadados, cache acadêmico, TTL/invalidação, classificação de correspondência e interpretação/persistência de evidências.

Não criar nem ampliar cliente MCP genérico dentro do OpenBanca. Um adapter MCP interno só pode existir como exceção temporária, com lacuna comprovada do OpenCode, escopo acadêmico específico, teste E2E real, limites de segurança e plano de migração. O `src/lib/mcp_client.ts` não deve ser removido ou refatorado nesta regra documental.

O OpenBanca não deve implementar seleção ou roteamento geral de modelos, autenticação direta em provedores de LLM, sessão/conversa paralela, agent loop genérico, executor autônomo de subagents, permission engine próprio ou sistema de commands paralelo. `banca_loop` não deve se transformar em um segundo harness; a coordenação de auditoria, correção, compilação, referências e revisão deve usar agents, skills, commands, tools, sessões e permissões do OpenCode.

Embeddings locais com modelos pequenos e classificadores/rerankers locais são possibilidades futuras auxiliares para memória, recuperação e deduplicação, somente após benchmark e decisão explícita do mantenedor. Não são prioridade do roadmap imediato, não podem substituir a cobertura exaustiva do manuscrito, decidir quais partes do TCC deixar de analisar, criar servidor autônomo, roteador geral de modelos ou segundo harness, e não devem ser implementados nesta tarefa.

## Agentes de IA no terminal

O procedimento operacional independente de fornecedor está em `docs/terminal-agent-workflow.md`. Esse manual não substitui este arquivo nem os protocolos especializados.

Antes de editar, o agente deve:

- ler `docs/terminal-agent-workflow.md`;
- registrar branch, SHA, base autorizada da PR (`BASE_REF`, em geral `origin/master`), merge-base, versões de Node/Bun e alterações locais preexistentes;
- preservar mudanças locais fora do escopo;
- trabalhar na branch da tarefa (branch dedicada nova **ou** branch de PR existente, conforme o contrato);
- não criar branch ou PR duplicada quando o trabalho já pertence a uma PR;
- não fazer push direto em `master` nem force push sem autorização humana explícita;
- revisar o diff local com `git --no-pager` e, no HEAD final, o range completo `"$BASE_REF"...HEAD`;
- descobrir e executar testes compatíveis com os arquivos alterados e com `package.json` / CI;
- classificar evidência por nível (inspeção, unitário, integração, OpenCode real, modelo real);
- classificar fases externas como `PASS`, `FAIL` ou `BLOCKED`;
- registrar honestamente testes não executados.

Não substitua execução real por mock, build, plano, catálogo de modelos, arquivo em disco ou relato do agente. A suíte baseline atual do CI está documentada no fluxo terminal e em `.github/workflows/ci.yml`; confirme os scripts reais antes de declarar validação.

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
- confirme que é uma issue-folha, não uma issue-mãe, tracking issue ou plano amplo de migração;
- aplique a política de `docs/jules-task-sizing.md`; tarefas com quatro ou mais pontos de complexidade devem ser divididas;
- use como padrão um único componente, até três arquivos de produção esperados, até 250 linhas de produção alteradas e até seis comportamentos independentes;
- exceções de tamanho exigem justificativa humana registrada antes do despacho;
- verifique que não existe tarefa do Jules ou PR aberta já vinculada;
- transforme o **corpo da issue** no contrato executável completo, curto e específico, com evidência, escopo, critérios, testes, riscos, branch-base e destino da PR;
- não trate comentários como parte garantida do prompt inicial do despacho por label;
- finalize e releia o corpo da issue antes de aplicar `jules`; nunca aplique o label primeiro e publique o contrato depois;
- use comentários somente para decisões, evidência, bloqueios, desbloqueios e auditoria;
- depois que o bot confirmar o início, não presuma que editar o corpo ou comentar atualizará a tarefa já criada;
- referencie regras permanentes em vez de copiar blocos extensos de governança em todo prompt;
- use `master` como branch-base por padrão; PR empilhada exige autorização humana explícita e base exata;
- não use o label para correções de uma PR existente; nesse caso, instrua `@jules` na própria PR;
- remova o label se os pré-requisitos deixarem de ser verdadeiros.

Consulte `docs/jules-dispatch-protocol.md` para o fluxo completo e `docs/jules-task-sizing.md` para decomposição e limites.

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
