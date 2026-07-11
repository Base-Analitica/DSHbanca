---
name: banca-referencias
description: Valida referências bibliográficas do texto contra bases de dados acadêmicas.
---
# Skill: Banca Referências

Valida referências contra bases acadêmicas.

## Quando usar
Para verificar a autenticidade e validade das referências citadas ao final de um trabalho acadêmico.

## Quando NÃO usar
Não use para avaliar a qualidade ou aderência das referências ao tema estudado, apenas sua existência factual nas bases.

## Entradas necessárias
- Caminho para o diretório ou arquivo `.bib` ou `Referências`.

## Ferramentas permitidas
- `banca_refs`

## Protocolo
1. Executar `banca_refs` para extrair a lista de referências.
2. Para cada referência extraída, tentar validação contra bases de dados externas.
3. Classificar cada referência: encontrada, não encontrada, ou suspeita.
4. Calcular o score geral de saúde das referências.
5. Gerar uma certidão formal de validação de fontes.

## Formato da saída
Um relatório Markdown em `.banca/reports/` com a "Certidão de Fontes" e a tabela de score.

## Limites e nível de confiança
Depende de conectividade e disponibilidade das bases de dados, mas é rigoroso para referências do tipo DOI e ISBN. Fontes antigas ou obscuras podem ser marcadas falsamente como não encontradas.

## Situações que exigem confirmação humana
Uma quantidade grande de referências não encontradas pode indicar problemas de conectividade, indisponibilidade da base de dados, ou falha no parser. O autor deve revisar manualmente e confirmar a validade.

## Relação com a rubrica ativa
Atua diretamente no Scorecard sob "Citações/Fontes", baseando as penalidades na tabela de impacto.

## Comportamento quando as evidências forem insuficientes
A referência assume estado "Suspeita" se os metadados estiverem corrompidos e nenhuma busca puder ser realizada com sucesso.
