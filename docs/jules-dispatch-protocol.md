# Protocolo de Despacho para o Google Jules

## Objetivo

Este documento define como o mantenedor do OpenBanca prepara, dispara, acompanha e audita tarefas executadas pelo Google Jules a partir de issues do GitHub.

A integração oficial inicia uma tarefa quando o label `jules` é aplicado a uma issue. O label é apenas um gatilho externo: não substitui triagem, decisão arquitetural, critérios de aceite, revisão de código ou validação E2E.

Referência oficial:

- https://jules.google/docs/running-tasks/#starting-tasks-from-github-issues

## Comportamento observado do prompt por label

Em despacho real observado no OpenBanca em **12 de julho de 2026**, a tarefa criada pelo label recebeu o **título e o corpo da issue existentes no momento do disparo**. Um contrato publicado depois em comentário não apareceu no prompt inicial da tarefa.

A documentação oficial confirma que o label inicia a tarefa, mas não promete que comentários posteriores façam parte do prompt inicial nem que atualizem uma tarefa já criada.

Portanto, para o fluxo automático do OpenBanca:

- o corpo da issue é a fonte do contrato executável;
- o contrato completo deve estar no corpo **antes** de aplicar `jules`;
- comentários não são parte garantida do prompt inicial;
- editar o corpo ou comentar depois da confirmação do bot não deve ser tratado como atualização da tarefa em execução;
- o Markdown pode aparecer achatado em texto corrido na interface do Jules, então o significado não pode depender apenas de tabelas, checkboxes, indentação ou separação visual.

Esta regra específica prevalece, no despacho por label, sobre qualquer redação genérica que permita guardar o contrato apenas em comentário.

## Divisão de responsabilidades

### Mantenedor e orquestrador

Responsável por:

- consultar o estado real de `master`, issues, PRs, branches, CI e documentação;
- escolher uma issue-folha pequena e verificável;
- resolver dependências e decisões humanas antes do despacho;
- transformar o corpo da issue no contrato executável completo;
- confirmar base, destino, arquivos permitidos, testes e riscos;
- conferir novamente o corpo antes de aplicar o label;
- aplicar `jules` somente depois dessa conferência;
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
[ ] issue-folha conforme docs/jules-task-sizing.md
[ ] critérios de aceite reproduzíveis
[ ] dependências disponíveis
[ ] nenhuma tarefa Jules ativa para a issue
[ ] nenhuma PR aberta implementando o mesmo escopo
[ ] conflitos com tarefas paralelas avaliados
[ ] corpo da issue contém o contrato executável completo
[ ] corpo permanece inequívoco quando o Markdown é achatado
[ ] branch-base e destino estão no corpo
[ ] aplicativo Jules autorizado no repositório
```

`needs:e2e` pode permanecer aplicado. Nesse caso, o corpo deve dizer exatamente qual validação real será executada ou preparada, e a issue não pode ser fechada sem essa evidência.

## Branch-base

No fluxo iniciado diretamente pela interface do Jules, uma pessoa escolhe o repositório e a branch. No fluxo disparado pelo label de issue, a documentação oficial não apresenta um seletor de branch.

Por segurança:

- o despacho automático por label parte da `master` atualizada;
- o corpo deve exigir `git fetch origin --prune` e registrar `origin/master`;
- o Jules deve registrar branch inicial, SHA inicial, SHA de `origin/master` e merge-base antes de alterar arquivos;
- se a tarefa não estiver baseada na `master` esperada, deve parar e registrar a divergência;
- PR empilhada não deve ser iniciada por label, salvo autorização humana explícita, base exata registrada e confirmação de que o mecanismo suporta essa base;
- correções em PR existente devem ser feitas com `@jules` na própria conversa da PR.

## Corpo obrigatório da issue

Antes do label, substitua ou reorganize o corpo da issue para que ele próprio seja o prompt executável.

O corpo deve ser curto, específico e conter as seções abaixo. Informações históricas extensas devem ficar na issue-mãe ou em comentários vinculados, não competir com o objetivo executável da folha.

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

### Requisitos e critérios de aceite

Cada requisito deve ser verificável por inspeção ou comando. Evite termos vagos como “melhorar”, “otimizar” ou “deixar robusto”.

Use frases completas e numeradas. Como a formatação pode ser achatada, não dependa apenas de caixas de seleção ou colunas de tabela para distinguir obrigação, exceção e proibição.

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

## Uso de comentários

Comentários da issue servem para:

- registrar decisão humana;
- justificar prioridade;
- documentar bloqueio e condição de desbloqueio;
- guardar evidência complementar;
- registrar divergência de despacho;
- auditar a entrega;
- apontar PRs e commits.

Comentários não substituem o corpo como prompt inicial do label.

Não aplique `jules` e depois publique o contrato em comentário. A confirmação automática do bot pode ocorrer antes do comentário e criar a tarefa com informação incompleta.

## Aplicação do label

Sequência obrigatória:

1. confirmar que a issue é uma folha pequena;
2. atualizar o **corpo** com o contrato completo;
3. reler o corpo como texto corrido e remover ambiguidades dependentes de formatação;
4. conferir labels e dependências;
5. consultar novamente PRs e tarefas relacionadas;
6. registrar em comentário apenas a evidência administrativa necessária;
7. aplicar `jules`;
8. verificar se o bot Jules comentou automaticamente na issue;
9. registrar qualquer falha de disparo;
10. não reaplicar repetidamente o label para contornar falha desconhecida.

A integração oficial trata o nome `jules` sem distinção entre maiúsculas e minúsculas, mas o OpenBanca usa a forma canônica minúscula definida em `.github/labels.yml`.

## Erro de prompt após o início

Depois que o bot confirmar que a tarefa começou:

- não presuma que editar o corpo atualizará a tarefa;
- não presuma que um comentário com instruções será ingerido pela tarefa iniciada por label;
- não crie uma segunda tarefa sobre o mesmo escopo;
- se a instrução ausente for crítica para segurança ou arquitetura, pause ou encerre a tarefa no serviço Jules e registre a ação;
- quando disponível, use o chat da própria tarefa do Jules para fornecer feedback durante a execução;
- se o escopo recebido ainda for seguro e suficiente, registre a divergência e faça auditoria reforçada de base, arquivos e testes.

Remover o label não encerra uma tarefa que já tenha começado.

## Acompanhamento

Após o disparo:

- não inicie outra tarefa sobre o mesmo escopo;
- acompanhe comentários do Jules e a PR criada;
- compare base, head, merge-base e SHAs;
- confira se a PR aponta para `master`;
- trate descrição, plano e relato do Jules como alegações a verificar;
- priorize a auditoria da PR entregue antes de despachar novas tarefas dependentes.

Se o Jules solicitar decisão de produto ou arquitetura que não esteja resolvida no corpo:

1. não permita escolha silenciosa;
2. remova `jules` se a tarefa ainda não tiver começado;
3. aplique `needs:human-decision`;
4. registre as opções e aguarde decisão humana.

## Correções após a entrega

Para corrigir uma PR existente:

- leia todos os comentários, reviews e checks;
- publique uma instrução curta e completa na Conversation da própria PR mencionando `@jules`;
- informe branch, base, head e SHA esperados;
- delimite arquivos e bloqueadores;
- exija testes no novo HEAD;
- proíba criação de uma segunda PR;
- confirme reconhecimento do bot quando esse mecanismo estiver disponível;
- não marque como pronta, não faça merge e não feche a issue antes da nova auditoria.

Quando o fluxo do Jules não puder editar a PR anterior, abra uma nova tarefa somente por decisão explícita do mantenedor, com base remota exata e escopo corretivo pequeno.

## Auditoria da entrega

A auditoria deve verificar:

1. corpo da issue e critérios de aceite efetivamente enviados;
2. labels e bloqueios;
3. base, head, merge-base e SHAs;
4. todos os arquivos alterados;
5. escopo indevido;
6. testes e CI no HEAD atual;
7. segurança;
8. documentação;
9. E2E real quando exigido;
10. divergências entre prompt recebido, alegações e execução observada.

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