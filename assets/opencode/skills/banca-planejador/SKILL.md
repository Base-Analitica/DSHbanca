# Skill: Banca Planejador

Define plano de correção para iteração do loop.

## Ativação

Invocar agente `@banca-planejador`.

## Entrada

- Context pack (`banca_context`)
- Relatório de auditoria
- Iterações anteriores

## Saída

- Plano markdown: o que corrigir, porquê, como
- Plano JSON: lista de operações (arquivo, oldText, newText)

## Estratégia

1. Priorizar achados críticos (travas)
2. Preferir adição de citação sobre remoção de texto
3. Evitar alterações em dados imutáveis
4. Máximo de 10 correções por iteração
