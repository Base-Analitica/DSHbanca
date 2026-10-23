---
name: banca-planejador
description: Define o plano de correção otimizado para a próxima iteração do loop.
---
# Skill: Banca Planejador

Define plano de correção para iteração do loop.

## Quando usar
No início de uma rodada de iteração, após a auditoria, para criar um plano acionável para o agente corretor.

## Quando NÃO usar
Não use diretamente como corretor. A skill não deve alterar arquivos de código fonte ou manuscritos do projeto principal, apenas documentos de planejamento.

## Entradas necessárias
- Context pack atualizado (via `banca_context`).
- Relatório de auditoria contendo as deficiências.
- Histórico de iterações anteriores.

## Ferramentas permitidas
A skill produz orientação textual e planejamento. Pode requerer leitura do histórico se fornecido no contexto, mas não grava arquivos diretamente.

## Protocolo
1. Analisar as dependências entre os problemas apontados na auditoria.
2. Priorizar achados críticos (como travas que limitam a nota a 4.0 ou 6.0).
3. Elaborar uma estratégia priorizando a adição de citação sobre a remoção de texto e mantendo intocáveis os imutáveis.
4. Restringir o escopo para um máximo de 10 correções planejadas por iteração, evitando instabilidade.
5. Produzir o artefato final.

## Formato da saída
- Plano em Markdown descrevendo a estratégia.
- Objeto ou lista estruturada para repasse ao executor da correção.

## Limites e nível de confiança
Confiança alta para o planejamento lógico; a implementação prática recairá sobre `banca-correcao`.

## Situações que exigem confirmação humana
Se o número de problemas críticos for gigantesco a ponto de exigir refatoração total da estrutura do TCC.

## Relação com a rubrica ativa
Usa os pesos da rubrica ativa para priorizar os problemas de maior impacto no score final.

## Comportamento quando as evidências forem insuficientes
Planejar iteração vazia, avisando o usuário que não há correções necessárias ou que os dados da auditoria não puderam ser lidos.
