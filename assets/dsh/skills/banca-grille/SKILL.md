---
name: banca-grille
description: Executa entrevista com o usuário antes de aplicar correções complexas ou ambíguas.
---
# Skill: Banca Grille

Entrevista exaustiva com usuário antes de executar correções complexas.

## Quando usar
Sempre que uma correção proposta esbarrar na Matriz de Decisão sob a categoria "Entrevistar" (alto risco, ambiguidade ou caminhos restritos).

## Quando NÃO usar
Não use para correções triviais (ex.: erros de digitação simples ou espaços em branco).

## Entradas necessárias
- Contexto do achado a ser corrigido.

## Ferramentas permitidas
Esta skill atua exclusivamente através da comunicação textual com o usuário para clarificação. Não executa ferramentas nem altera arquivos diretamente.

## Protocolo
1. Apresentar contexto do achado apontado na auditoria ou revisão.
2. Perguntar ao usuário de forma objetiva sobre:
   - Escopo: quais arquivos ou seções devem ser corrigidos?
   - Imutáveis: o que NÃO pode ser alterado no texto em questão?
   - Tolerância: qual é a nota alvo ou limite aceitável de refatoração?
3. Salvar respostas no contexto da iteração atual.
4. Só prosseguir para a próxima etapa quando todas as respostas forem esclarecidas.

## Formato da saída
Repasse de contexto claro e estruturado para o agente/skill solicitante.

## Limites e nível de confiança
Alta confiança por tratar-se de confirmação direta com o autor (human-in-the-loop).

## Situações que exigem confirmação humana
A natureza desta skill é inteiramente baseada em interação humana.

## Relação com a rubrica ativa
Atua como um filtro de segurança para não comprometer o projeto antes de aplicar regras estritas de nota.

## Comportamento quando as evidências forem insuficientes
Perguntar novamente ao usuário ou solicitar arquivos adicionais para fornecer melhor contexto ao problema.
