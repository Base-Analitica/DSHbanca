# Skill: Banca Avaliação

Avalia monografias nos eixos ABNT, citações, conteúdo e estilo.

## Ativação

Invocar agente `@banca-auditor`.

## Protocolo

1. Carregar contexto via `banca_context`
2. Executar `banca_auditar` para métricas objetivas
3. Avaliar cada eixo com base no contexto e nas métricas
4. Gerar parecer textual por eixo
5. Delegar ao integrador para nota final

## Rubrica

Perfil: `banca-rigorosa`
- ABNT/Estrutura: peso 3
- Citações/Fontes: peso 3
- Conteúdo/Lógica: peso 2
- Estilo Acadêmico: peso 2

## Travas

- >30% parágrafos sem citação → nota máxima 4.0
- Ficha catalográfica caseira (sem CRB) → nota máxima 6.0
- Conclusão rotulada como "Conclusão" em vez de "Considerações Finais" → nota máxima 6.0

## Saída

Relatório markdown em `.banca/reports/`.
