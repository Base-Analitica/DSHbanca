# Protocolo de Despacho para o Google Jules

## Objetivo

Este documento define como o mantenedor do OpenBanca prepara, dispara, acompanha e audita tarefas executadas pelo Google Jules a partir de issues do GitHub.

A integração oficial inicia uma tarefa quando o label `jules` é aplicado a uma issue. O label é apenas um gatilho externo: não substitui triagem, decisão arquitetural, critérios de aceite, revisão de código ou validação E2E.

Referência oficial:

- https://jules.google/docs/running-tasks/#starting-tasks-from-github-issues

## Divisão de responsabilidades

### Mantenedor e orquestrador

Responsável por:

- consultar o estado real de `master`, issues, PRs, branches, CI e documentação;
- escolher uma tarefa pequena e verificável;
- resolver dependências e decisões humanas antes do despacho;
- produzir o contrato completo da tarefa;
- confirmar base, destino, arquivos permitidos, testes e riscos;
- aplicar o label `jules`;
- auditar diff, testes, CI, documentação e E2E no HEAD entregue;
- decidir merge, bloqueio, correção, divisão ou fechamento.

### Jules

Responsável por:

- confirmar branch, SHA e ambiente real da tarefa;
- implementar somente o escopo autorizado;
- executar testes determinísticos e validações solicitadas;
- registrar resultados, códigos de saída e limitações;
- criar no máximo uma PR para a tarefa;
- corrigir a própria PR quando instruído com `@jules`.

O plano declarado pelo Jules não é evidência de implementação. O resumo final do Jules não substitui inspeção do diff nem execução no HEAD atual.

## Pré-condições obrigatórias

Antes de aplicar `jules`, confirme:

```text
[ ] issue aberta e corretamente triada
[ ] exatamente um tipo
[ ] exatamente uma prioridade
[ ] uma ou duas áreas
[ ] agent:ready aplicado
[ ] agent:blocked ausente
[ ] needs:human-decision ausente
[ ] critérios de aceite reproduzíveis
[ ] dependências disponíveis
[ ] nenhuma tarefa Jules ativa para a issue
[ ] nenhuma PR aberta implementando o mesmo escopo
[ ] conflitos com tarefas paralelas avaliados
[ ] contrato completo publicado
[ ] branch-base e destino registrados
[ ] aplicativo Jules autorizado no repositório
```

`needs:e2e` pode permanecer aplicado. Nesse caso, a tarefa deve executar ou preparar explicitamente a validação real exigida, e a issue não pode ser fechada sem essa evidência.

## Branch-base

No fluxo iniciado diretamente pela interface do Jules, uma pessoa escolhe o repositório e a branch. No fluxo disparado pelo label de issue, a documentação oficial não apresenta um seletor de branch.

Por segurança:

- o despacho automático por label parte da `master` atualizada;
- o contrato deve exigir `git fetch origin --prune` e registrar `origin/master`;
- o Jules deve registrar branch inicial, SHA inicial, SHA de `origin/master` e merge-base antes de alterar arquivos;
- se a tarefa não estiver baseada na `master` esperada, deve parar e registrar a divergência;
- PR empilhada não deve ser iniciada por label, salvo autorização humana explícita, base exata registrada e confirmação de que o mecanismo suporta essa base;
- correções em PR existente devem ser feitas com `@jules` na própria conversa da PR.

## Contrato obrigatório da tarefa

Antes do label, publique na issue um contrato com as seções abaixo.

### Identificação

- repositório;
- número da issue;
- objetivo único;
- branch-base;
- branch esperada;
- título esperado;
- destino da PR;
- autorização ou proibição de PR empilhada.

### Evidência

- comportamento observado;
- arquivos, funções ou linhas relevantes;
- comandos e resultados já observados;
- impacto;
- causa provável identificada como hipótese, quando ainda não comprovada.

### Escopo

- arquivos ou diretórios permitidos;
- mudanças necessárias;
- fora de escopo;
- dependências;
- risco de conflito com outras PRs.

### Critérios de aceite

Cada critério deve ser verificável por inspeção ou comando. Evite termos vagos como “melhorar”, “otimizar” ou “deixar robusto”.

### Testes

Liste comandos obrigatórios, incluindo quando aplicáveis:

```bash
bun run typecheck
bun run build
bun test
bash scripts/validate.sh
bash scripts/check-secrets.sh --ci
```

Inclua testes específicos do defeito e casos negativos relevantes.

### Segurança

Exija, conforme o escopo:

- validação de paths;
- allowlist de executáveis;
- argumentos separados;
- `shell: false`;
- timeout;
- limite de saída;
- encerramento garantido;
- ausência de credenciais e dados sensíveis em logs.

### Relatório final

Exija:

- branch e SHA iniciais;
- SHA da base remota;
- merge-base;
- SHA final;
- arquivos alterados;
- comandos executados;
- códigos de saída;
- testes aprovados, reprovados e bloqueados;
- limitações;
- número e destino da PR.

## Aplicação do label

Sequência obrigatória:

1. atualizar a issue com o contrato completo;
2. conferir labels e dependências;
3. consultar novamente PRs e tarefas relacionadas;
4. aplicar `jules`;
5. verificar se o bot Jules comentou automaticamente na issue;
6. registrar qualquer falha de disparo;
7. não reaplicar repetidamente o label para contornar falha desconhecida.

A integração oficial trata o nome `jules` sem distinção entre maiúsculas e minúsculas, mas o OpenBanca usa a forma canônica minúscula definida em `.github/labels.yml`.

## Acompanhamento

Após o disparo:

- não inicie outra tarefa sobre o mesmo escopo;
- acompanhe comentários do Jules e a PR criada;
- compare base, head, merge-base e SHAs;
- confira se a PR aponta para `master`;
- trate descrição, plano e relato do Jules como alegações a verificar;
- priorize a auditoria da PR entregue antes de despachar novas tarefas dependentes.

Se o Jules solicitar decisão de produto ou arquitetura que não esteja resolvida no contrato:

1. não permita escolha silenciosa;
2. remova `jules` se a tarefa ainda não tiver começado;
3. aplique `needs:human-decision`;
4. registre as opções e aguarde decisão humana.

## Correções após a entrega

Para corrigir uma PR existente:

- leia todos os comentários, reviews e checks;
- publique uma instrução completa na própria PR mencionando `@jules`;
- informe branch, base, head e SHA esperados;
- delimite arquivos e bloqueadores;
- exija testes no novo HEAD;
- proíba criação de uma segunda PR;
- não marque como pronta, não faça merge e não feche a issue antes da nova auditoria.

Quando o fluxo do Jules não puder editar a PR anterior, abra uma nova tarefa somente por decisão explícita do mantenedor, com base remota exata e escopo corretivo pequeno.

## Auditoria da entrega

A auditoria deve verificar:

1. issue e critérios de aceite;
2. labels e bloqueios;
3. base, head, merge-base e SHAs;
4. todos os arquivos alterados;
5. escopo indevido;
6. testes e CI no HEAD atual;
7. segurança;
8. documentação;
9. E2E real quando exigido;
10. divergências entre alegações e execução observada.

Não considere como prova suficiente:

- plano ou resumo do Jules;
- arquivo copiado;
- teste unitário isolado;
- mock;
- build;
- catálogo de modelos;
- teste executado em SHA antigo;
- commit que apenas declara bloqueio de ambiente.

## Encerramento do despacho

O label `jules` deve ser removido quando:

- o disparo não é mais desejado;
- surgiu bloqueio ou decisão humana;
- foi detectada tarefa duplicada;
- a issue foi substituída ou dividida;
- o mecanismo tentou iniciar trabalho na base errada;
- manter o label puder causar novo disparo acidental.

A remoção do label não encerra tarefa já iniciada no serviço Jules. Quando necessário, pause ou encerre a tarefa no próprio Jules e registre a ação na issue.

## Limites

- Uma issue gera no máximo uma tarefa ativa do Jules.
- Uma tarefa gera no máximo uma PR.
- Não há auto-merge.
- O Jules não altera prioridade ou governança por iniciativa própria.
- O Jules não fecha a issue.
- O Jules não inicia próxima tarefa automaticamente.
- P0 e P1 continuam sujeitos à mesma auditoria; prioridade alta não autoriza atalhos.
- `needs:e2e` exige evidência real antes do fechamento.
