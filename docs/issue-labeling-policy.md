# Política de Labels para Issues

## Objetivo

Esta política define como humanos e agentes de IA devem classificar, atualizar, despachar e encerrar issues do OpenBanca.

Os labels existem para responder cinco perguntas sem depender de interpretação livre:

1. Que tipo de trabalho é este?
2. Qual é o impacto atual?
3. Qual subsistema está afetado?
4. Um agente pode agir sozinho ou ainda falta decisão/validação?
5. A execução automática pelo Jules foi deliberadamente autorizada?

A fonte de verdade dos nomes, cores, descrições e grupos é [`.github/labels.yml`](../.github/labels.yml).

## Regra mínima

Todo issue aberto deve possuir:

- exatamente **um label de tipo**;
- exatamente **um label de prioridade**;
- de **um a dois labels de área**;
- zero ou mais labels operacionais;
- zero ou um label de automação.

Exemplo válido:

```text
bug
priority:p0
area:opencode
needs:e2e
agent:ready
```

Um issue sem tipo, prioridade ou área está incompletamente triado. O label `jules` não corrige triagem incompleta e não substitui `agent:ready`.

## Labels de tipo

Apenas um dos seguintes pode ser aplicado:

| Label | Aplicar quando |
|---|---|
| `bug` | Há comportamento incorreto, falha funcional, risco ou resultado verificavelmente errado. |
| `enhancement` | O trabalho adiciona capacidade, melhora arquitetura ou amplia algo que não está propriamente quebrado. |
| `documentation` | A correção é predominantemente documental e não exige alteração funcional relevante. |

### Regras

- Um redesenho necessário para corrigir um defeito continua sendo `bug`; `enhancement` pode ser adicionado apenas durante a migração de issues legados, mas novos issues devem ter um único tipo.
- Não usar `documentation` para esconder uma falha funcional cuja manifestação aparece na documentação.
- Não usar `enhancement` como categoria genérica para qualquer trabalho grande.

## Labels de prioridade

A prioridade representa o impacto **atual do trabalho ainda não resolvido**, não o tamanho da implementação.

| Label | Definição operacional |
|---|---|
| `priority:p0` | Bloqueia a interface ou fluxo central; cria risco crítico; ou torna resultados centrais fundamentalmente inválidos. |
| `priority:p1` | Falha grave, alto impacto, sem contorno aceitável para uso normal. |
| `priority:p2` | Problema moderado ou localizado, com contorno temporário ou impacto limitado. |
| `priority:p3` | Melhoria menor, manutenção, limpeza ou impacto baixo. |

### Exemplos

- Commands principais não são descobertos pelo OpenCode: `priority:p0`.
- Auditor pode editar arquivos apesar de ser declarado read-only: `priority:p1`.
- Documentação mostra um argumento inexistente: normalmente `priority:p2`.
- Ajuste cosmético sem efeito funcional: `priority:p3`.

### Alteração de prioridade

Agentes não podem elevar ou reduzir prioridade silenciosamente.

Toda mudança de prioridade deve incluir comentário contendo:

1. prioridade anterior e nova;
2. evidência objetiva;
3. impacto residual;
4. dependências ainda abertas, quando existirem.

P0 e P1 não devem ser rebaixados apenas porque existe uma correção proposta. O rebaixamento exige que a parte crítica tenha sido comprovadamente resolvida.

## Labels de área

Aplique pelo menos um e no máximo dois:

| Label | Escopo |
|---|---|
| `area:opencode` | Commands, skills, agents, permissões e integração com o host. |
| `area:audit` | Rubricas, findings, scoring, ABNT, conteúdo e estilo. |
| `area:manuscript` | Ingestão, LaTeX, Markdown, DOCX, includes, parsing e proveniência. |
| `area:references` | BibTeX, DOI, Crossref, MCP, cache, referências e citações. |
| `area:correction` | Correções, snapshots, restore, rollback, diff e contrato. |
| `area:security` | Paths, isolamento, processos externos, permissões e exposição de dados. |
| `area:ci` | GitHub Actions, build, testes, release e validações automatizadas. |

Se um issue parecer exigir três ou mais áreas, o agente deve avaliar se ele precisa ser dividido em issues menores.

## Labels operacionais

### `agent:ready`

Aplicar somente quando:

- o problema e o resultado esperado estão claros;
- os critérios de aceite são reproduzíveis;
- não existe decisão de produto pendente;
- as dependências necessárias estão disponíveis;
- o agente consegue identificar quais arquivos e testes pertencem ao escopo.

O label não significa que a solução será simples. Significa apenas que não falta uma decisão anterior.

### `agent:blocked`

Aplicar somente com comentário explícito contendo:

- qual dependência bloqueia;
- o issue, PR, decisão ou recurso relacionado;
- qual condição remove o bloqueio.

Não usar para indicar apenas que o trabalho é difícil ou grande.

### `needs:human-decision`

Aplicar quando uma pessoa precisa escolher entre alternativas com impacto de produto, arquitetura, política, compatibilidade ou risco.

Exemplos:

- restringir a versão atual a LaTeX ou implementar adapters para outros formatos;
- executar rollback automático ou exigir confirmação humana;
- definir canal privado real para vulnerabilidades;
- decidir se uma nota representa qualidade acadêmica ou prontidão interna.

Um agente pode investigar e propor alternativas, mas não deve implementar a parte ambígua como se a decisão já tivesse sido tomada.

### `needs:e2e`

Aplicar quando o issue não pode ser encerrado apenas com testes unitários, mocks ou inspeção estática.

Exemplos:

- descoberta real de commands, skills ou agents no OpenCode;
- enforcement real de permissões;
- integração MCP;
- compilação LaTeX real;
- workflow do GitHub Actions executado;
- comportamento dependente do ambiente do host.

O issue só pode ser fechado quando a evidência E2E estiver registrada no próprio issue ou em PR/artefato claramente vinculado.

## Label de automação

### `jules`

O label `jules` é um **gatilho de execução** para a integração oficial do Google Jules. Ele não representa tipo, prioridade, área, prontidão ou aprovação.

Aplicar somente quando todas as condições abaixo forem verdadeiras:

- a issue possui exatamente um tipo, uma prioridade e uma ou duas áreas;
- `agent:ready` está aplicado;
- `agent:blocked` e `needs:human-decision` não estão aplicados;
- o corpo da issue ou um comentário explícito do mantenedor contém contrato completo de tarefa;
- não existe tarefa do Jules ativa para a issue;
- não existe PR aberta que já implemente o mesmo escopo;
- dependências e conflitos com outras branches ou PRs foram verificados;
- a branch-base é `master`, salvo autorização humana explícita para PR empilhada;
- o destino esperado da PR está registrado;
- arquivos permitidos, testes, riscos e ações fora de escopo estão registrados.

O contrato de tarefa deve seguir [`docs/jules-dispatch-protocol.md`](jules-dispatch-protocol.md).

Não aplicar `jules`:

- para pedir correções em PR já existente; use `@jules` na própria PR;
- enquanto houver decisão humana pendente;
- quando o trabalho estiver bloqueado;
- como fila genérica para qualquer issue pronta;
- para iniciar duas tarefas concorrentes sobre o mesmo escopo;
- sem confirmar que o aplicativo Jules possui acesso ao repositório.

Se qualquer pré-requisito deixar de ser verdadeiro antes do início da execução, remova o label e registre a razão.

## Algoritmo obrigatório para agentes

Antes de criar ou atualizar um issue:

1. Ler `.github/labels.yml` e este documento.
2. Não inventar labels.
3. Identificar um único tipo.
4. Classificar o impacto atual em P0–P3.
5. Escolher uma ou duas áreas.
6. Verificar se existe decisão humana pendente.
7. Verificar se validação E2E é necessária.
8. Aplicar `agent:ready` somente se o trabalho estiver executável sem decisão adicional.
9. Se usar `agent:blocked`, comentar o bloqueio concreto.
10. Conferir que não existem dois labels de prioridade ou mais de dois labels de área.
11. Antes de aplicar `jules`, executar integralmente o protocolo de despacho e verificar duplicidade de tarefa ou PR.

## Regras para criação de issues

Todo novo issue técnico deve conter, quando aplicável:

- resumo do problema;
- evidência no repositório;
- impacto;
- severidade justificada;
- solução ou direção recomendada;
- critérios de aceite verificáveis;
- testes necessários;
- arquivos prováveis;
- restrições ou ações que não devem ser feitas.

O título deve descrever o problema. Para novos issues, a prioridade deve ficar no label, não precisa ser duplicada no título. Prefixos P0/P1/P2 já existentes podem permanecer durante a migração.

## Regras para fechamento

Um agente não deve fechar um issue quando:

- algum critério de aceite essencial não foi atendido;
- a alteração existe apenas em branch sem evidência vinculada;
- `needs:e2e` está aplicado e a validação real não foi executada;
- `needs:human-decision` continua sem decisão registrada;
- o estado persistido contradiz o filesystem ou os testes;
- a correção resolve apenas o sintoma e deixa a causa central aberta.

Ao fechar, o comentário final deve informar:

- o que mudou;
- commit ou PR relevante;
- testes executados;
- limitações e itens não validados;
- issues de acompanhamento, se houver.

## Issues parcialmente resolvidos

Quando apenas parte do problema foi corrigida:

1. manter o issue aberto; ou
2. dividir o restante em issue novo e vinculado, somente se isso melhorar claramente o escopo.

Não fechar um issue amplo e deixar requisitos importantes apenas em comentário sem rastreamento.

## Labels e dependências

Labels não substituem relações explícitas entre issues.

Quando um issue depende de outro:

- citar o número do issue bloqueador no corpo ou comentário;
- usar `agent:blocked` se a dependência realmente impedir execução;
- remover `agent:blocked` assim que a condição for satisfeita;
- reavaliar `agent:ready` após o desbloqueio;
- não aplicar `jules` antes da remoção comprovada do bloqueio.

## Automação

O workflow `.github/workflows/sync-labels.yml` sincroniza nomes, cores e descrições definidos em `.github/labels.yml`.

A automação:

- cria labels ausentes;
- atualiza cor e descrição de labels existentes;
- não remove labels desconhecidos automaticamente;
- falha diante de nomes duplicados, cores inválidas ou configuração incompleta.

O label `jules` possui um efeito adicional externo ao workflow: quando aplicado a uma issue e o aplicativo Jules está autorizado, a integração do Google inicia uma tarefa e comenta automaticamente na issue.

A remoção ou renomeação de um label deve ser uma mudança deliberada, revisada e acompanhada de migração dos issues afetados.

## Resumo de conformidade

Um issue está corretamente classificado quando:

```text
[ ] possui um tipo
[ ] possui uma prioridade
[ ] possui uma ou duas áreas
[ ] não contém labels inventados
[ ] decisões humanas pendentes estão marcadas
[ ] necessidade de E2E está marcada
[ ] bloqueios possuem comentário concreto
[ ] agent:ready só aparece em trabalho realmente executável
[ ] jules só aparece após o protocolo de despacho e sem tarefa ou PR duplicada
```
