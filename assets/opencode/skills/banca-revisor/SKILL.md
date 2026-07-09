# Skill: Banca Revisor

Revisa diff de correções e bloqueia regressão.

## Ativação

Invocar agente `@banca-revisor`.

## Protocolo

1. Comparar diff entre snapshot e estado atual
2. Verificar:
   - Nenhum dado imutável alterado
   - Nenhuma citação removida sem substituição
   - Nenhum caminho protegido modificado
   - Compilação bem-sucedida
3. Se regressão: rejeitar diff, sugerir rollback

## Critérios de Bloqueio

- Score caiu → bloqueio
- Dado imutável alterado → bloqueio
- Citação removida sem substituta → bloqueio
- 20+ linhas removidas sem justificativa → alerta
