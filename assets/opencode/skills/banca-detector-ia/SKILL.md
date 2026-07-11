---
name: banca-detector-ia
description: Analisa padrões estilísticos sinalizados pela heurística interna e produz uma triagem não conclusiva, sem determinar autoria por IA.
---
# Skill: Banca Detector IA

Triagem de risco de texto gerado por IA.

## Quando usar
Para analisar suspeitas de geração por IA em trechos sinalizados, aplicando uma heurística de padrões linguísticos repetitivos.

## Quando NÃO usar
Nunca use para emitir laudos conclusivos sobre autoria ou uso de IA, nem como justificativa primária para reprovação.

## Entradas necessárias
- Caminho para o diretório alvo.

## Ferramentas permitidas
- `banca_ia`

## Protocolo
1. Executar `banca_ia` para scan heurístico do diretório.
2. Para análise profunda: combinar a execução com ensemble opcional.
3. Combinar scores heurísticos gerados e formatar o diagnóstico.
4. Gerar relatório contendo níveis de risco e evidências identificadas.

## Formato da saída
Relatório em Markdown com Risco (baixo/moderado/alto), Confiança (0-100) e listagem de trechos por arquivo.

## Limites e nível de confiança
A confiança é inerentemente baixa. A heurística baseia-se em vocabulário comum de LLMs e previsibilidade de n-gramas, que também ocorrem em texto humano.

## Situações que exigem confirmação humana
O relatório final sempre exige análise do orientador/banca para qualquer tomada de decisão. A skill nunca pune automaticamente.

## Relação com a rubrica ativa
O relatório pode ser anexado como evidência extra ao avaliador humano, mas não afeta automaticamente o Scorecard técnico.

## Comportamento quando as evidências forem insuficientes
Se o documento for curto demais, deve reportar "Evidência Insuficiente" sem atribuir classificação de risco.
