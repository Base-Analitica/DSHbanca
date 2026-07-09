# Skill: Banca Detector IA

Triagem de risco de texto gerado por IA.

## Ativação

Invocar agente ou via `/banca:ia`.

## Protocolo

1. Executar `banca_ia` para scan heurístico
2. Para análise profunda: executar ensemble Python opcional
3. Combinar scores heurísticos + ensemble
4. Gerar relatório com risco e evidências

## Saída

- Risco: baixo / moderado / alto
- Confiança: 0-100
- Evidências por arquivo e trecho

## Limitações

- Heurística identifica padrões comuns de IA, não IA real
- Ensemble Python requer transformers + torch
- Nenhuma conclusão acusatória automática
