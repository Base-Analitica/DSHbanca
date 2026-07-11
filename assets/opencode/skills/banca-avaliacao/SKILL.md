---
name: banca-avaliacao
description: Avalia monografias nos eixos ABNT, citações, conteúdo e estilo para nota final.
---
# Skill: Banca Avaliação

Avalia monografias nos eixos ABNT, citações, conteúdo e estilo.

## Quando usar
Sempre que for necessário gerar um relatório completo de avaliação de um documento ou obter métricas objetivas de sua qualidade técnica.

## Quando NÃO usar
Não use para aplicar correções diretas no texto. Não use para triagem exclusiva de IA sem análise de conteúdo.

## Entradas necessárias
- Caminho para o diretório ou arquivo alvo.
- Contexto ativo da monografia ou documento.

## Ferramentas permitidas
- `banca_auditar`
- `banca_context`

## Protocolo
1. Carregar contexto via `banca_context`.
2. Executar `banca_auditar` para extrair métricas objetivas.
3. Avaliar cada eixo com base no contexto e nas métricas levantadas.
4. Gerar parecer textual por eixo.
5. Delegar ao integrador para compilação da nota final.

## Formato da saída
Parecer textual estruturado em Markdown. O relatório será salvo em disco apenas se o comando ativo possuir protocolo explícito com `save: true`.

## Limites e nível de confiança
A avaliação de conteúdo e estilo acadêmico depende da heurística do modelo. Confiança limitada/média: as contagens objetivas servem de base, mas não equivalem a uma validação normativa ABNT completa e infalível.

## Situações que exigem confirmação humana
- Nota sugerida abaixo de 4.0 por problemas estruturais severos.
- Identificação de falha grave na compilação do relatório.

## Relação com a rubrica ativa
Perfil: `banca-rigorosa`
- ABNT/Estrutura: peso 3
- Citações/Fontes: peso 3
- Conteúdo/Lógica: peso 2
- Estilo Acadêmico: peso 2
- Travas ativas:
  - >30% parágrafos sem citação → nota máxima 4.0
  - Ficha catalográfica caseira (sem CRB) → nota máxima 6.0
  - Conclusão rotulada de forma incorreta → nota máxima 6.0

## Comportamento quando as evidências forem insuficientes
Se a contagem não puder ser realizada com `banca_auditar` ou o contexto estiver vazio, interromper e sinalizar erro grave. Não inferir notas sem dados base.
