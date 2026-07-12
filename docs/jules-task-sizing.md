# Política de Tamanho de Tarefas para o Jules

## Objetivo

Esta política define o tamanho máximo e o formato padrão das tarefas entregues ao Google Jules no OpenBanca.

O problema que ela evita é recorrente: uma issue pode estar tecnicamente bem descrita, mas ainda exigir decisões, alterações e validações demais para uma única execução do Jules. Contratos excessivamente longos também diluem o objetivo principal e aumentam a chance de implementação parcial, escopo indevido ou evidência enganosa.

A regra padrão passa a ser:

> O Jules recebe apenas uma issue-folha, com uma única fatia funcional verificável e uma única PR esperada.

Issues-mãe, tracking issues e planos de migração não recebem o label `jules`.

## Unidade mínima de trabalho

Uma tarefa está suficientemente mastigada quando contém:

1. um único resultado observável;
2. uma decisão arquitetural já tomada;
3. um componente ou camada principal;
4. uma causa ou hipótese técnica delimitada;
5. critérios de aceite que podem ser verificados sem interpretar intenção;
6. testes diretamente ligados ao comportamento alterado;
7. uma única estratégia de branch e PR.

Testes, fixtures e pequenos ajustes de tipos necessários para a mesma fatia não contam como um segundo objetivo.

## Limites padrão

Salvo exceção humana registrada antes do despacho, uma tarefa do Jules deve respeitar:

- no máximo **um componente principal**;
- no máximo **três arquivos de produção esperados**;
- alvo de até **250 linhas de produção alteradas**;
- no máximo **seis comportamentos independentes** nos critérios de aceite;
- nenhuma decisão de produto ou arquitetura pendente;
- nenhuma migração simultânea de vários consumidores;
- nenhuma combinação de implementação ampla, atualização documental extensa e E2E complexo na mesma tarefa.

Arquivos de teste, fixtures e snapshots de teste não entram no limite de três arquivos de produção. Os números são limites de planejamento, não autorização para aceitar código ruim ou incompleto.

Uma exceção exige comentário do mantenedor explicando por que a divisão aumentaria o risco ou impediria uma mudança atômica.

## Orçamento de complexidade

Antes do despacho, atribua um ponto para cada condição verdadeira:

- cria uma nova abstração compartilhada;
- altera contrato público, configuração persistida ou estado;
- espera modificar mais de três arquivos de produção;
- atravessa mais de uma área `area:*`;
- exige validação real externa, como OpenCode, MCP ou LaTeX;
- envolve paths, subprocessos, permissões ou outro risco de segurança;
- possui mais de seis comportamentos independentes de aceite;
- ainda contém incerteza arquitetural relevante;
- migra mais de um consumidor ou tool;
- exige documentação ampla para não deixar a interface inconsistente.

Interpretação:

- **0–2 pontos:** normalmente adequada para despacho;
- **3 pontos:** exige revisão explícita do mantenedor e justificativa para não dividir;
- **4 ou mais pontos:** divisão obrigatória antes de aplicar `jules`.

O cálculo é uma ferramenta de triagem. Não substitui julgamento técnico nem torna uma tarefa automaticamente segura.

## Sinais obrigatórios de divisão

Divida a tarefa quando ela combinar dois ou mais itens abaixo:

- definição de tipos ou contrato;
- parser ou resolução de entrada;
- segurança e casos negativos;
- travessia ou orquestração recursiva;
- migração de consumidores;
- persistência ou fingerprint;
- atualização documental ampla;
- E2E em ambiente externo.

Exemplos de tarefas grandes demais:

- criar loader, resolver paths, detectar ciclos, gerar fingerprint e migrar auditoria;
- corrigir commands, atualizar toda a documentação e provar todos os fluxos em OpenCode real;
- criar motor de scoring, migrar auditoria, loop, status e correção na mesma PR;
- corrigir subprocesso, redesenhar protocolo e validar vários provedores reais ao mesmo tempo.

## Sequência preferida de decomposição

Para mudanças arquiteturais, prefira uma cadeia como:

1. contrato e função pura;
2. casos negativos e segurança;
3. integração de um consumidor;
4. migração dos consumidores restantes em tarefas separadas;
5. E2E real;
6. consolidação documental.

Cada etapa deve produzir valor verificável e deixar um contrato estável para a próxima.

A tarefa seguinte só é liberada depois que a PR anterior for auditada, integrada à `master` e revalidada no novo HEAD.

## Issues-mãe e issues-folha

Uma issue-mãe:

- registra o problema completo;
- preserva prioridade e impacto global;
- lista subtarefas e dependências;
- permanece com `agent:blocked` enquanto as folhas não forem concluídas;
- nunca recebe `jules`.

Uma issue-folha:

- possui objetivo único;
- pode ser implementada sem nova decisão;
- tem arquivos e testes delimitados;
- possui no máximo uma PR;
- pode receber `agent:ready` e, após o protocolo de despacho, `jules`.

## Formato do contrato

O contrato da tarefa deve ser curto e específico. Regras permanentes devem ser referenciadas, não copiadas integralmente em todo prompt.

O contrato deve conter somente:

1. identificação e base exata;
2. objetivo único;
3. evidência atual;
4. arquivos permitidos;
5. até seis requisitos funcionais principais;
6. critérios de aceite;
7. testes específicos e comandos globais;
8. fora de escopo;
9. relatório final esperado.

Evite repetir longas listas genéricas já presentes em `AGENTS.md`, `docs/jules-dispatch-protocol.md` ou documentos de segurança. Repetição excessiva não substitui decomposição.

## Correções em PR existente

Quando uma PR do Jules falhar na auditoria:

- não envie uma nova lista ampla de problemas acumulados;
- agrupe somente correções inseparáveis da mesma causa;
- instrua `@jules` na própria PR com um único lote corretivo;
- se houver mais de uma causa independente, bloqueie a PR e crie issues corretivas pequenas;
- não autorize uma segunda PR para o mesmo escopo sem decisão explícita.

## Verificação antes do label `jules`

Além do protocolo geral, confirme:

```text
[ ] é uma issue-folha
[ ] possui um único resultado observável
[ ] complexidade entre 0 e 2, ou exceção de 3 pontos registrada
[ ] respeita o limite padrão de arquivos e comportamentos
[ ] não combina arquitetura, migração ampla e E2E
[ ] o contrato referencia regras permanentes sem repeti-las excessivamente
[ ] a tarefa seguinte permanece bloqueada até auditoria e merge
```

Se algum item falhar, não aplique `jules`; divida ou esclareça a tarefa primeiro.
