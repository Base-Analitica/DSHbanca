---
name: banca-detector-ia
description: Analisa padrões estilísticos sinalizados pela heurística interna e produz uma triagem não conclusiva, sem determinar autoria por IA.
---
# Skill: Banca Detector IA

Triagem heurística não conclusiva de padrões associados a texto gerado por IA.

## Quando usar
Para analisar suspeitas de geração por IA em trechos sinalizados, aplicando uma heurística de padrões linguísticos repetitivos.

## Quando NÃO usar
Nunca use para emitir laudos conclusivos sobre autoria ou uso de IA, nem como justificativa primária para reprovação.

## Entradas necessárias
- Caminho para o diretório alvo.

## Ferramentas permitidas
- `banca_ia`

## Protocolo
1. Executar `banca_ia` para scan heurístico do diretório e ler método efetivo, cobertura e limitações do relatório.
2. Não somar nem tirar média entre scores Python e contagens regex: os agregados são apresentados por método e não são comparáveis.
3. Se o método efetivo for Python, lembrar que a disponibilidade do módulo não é prova de execução e que a confiança fixa de 0.85 não é calibrada.
4. Registrar por arquivo o método efetivo, os parágrafos elegíveis/analisados/omitidos e o truncamento; ausência de elegíveis é ausência de evidência, não risco baixo.

## Formato da saída
Relatório Markdown retornado pela ferramenta com método efetivo por arquivo (Python, regex ou não analisado), motivo, elegíveis/analisados/omitidos, truncamento e limitações. Não há confiança calibrada.

## Limites e nível de confiança
A heurística é inerentemente não calibrada. A heurística baseia-se em vocabulário comum de LLMs e previsibilidade de n-gramas, que também ocorrem em texto humano legítimo.

## Situações que exigem confirmação humana
O relatório final sempre exige análise do orientador/banca para qualquer tomada de decisão. A skill nunca pune automaticamente.

## Relação com a rubrica ativa
O relatório pode ser anexado como evidência extra ao avaliador humano, mas não afeta automaticamente o Scorecard técnico.

## Comportamento quando as evidências forem insuficientes
Se o documento for curto demais, se não houver parágrafos elegíveis ou se o método efetivo for "não analisado", deve reportar "Evidência Insuficiente" sem atribuir classificação de risco.
