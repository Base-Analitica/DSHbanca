# Skill: Banca Referências

Valida referências contra bases acadêmicas.

## Ativação

Invocar agente `@banca-fontes`.

## Protocolo

1. Executar `banca_refs` para listar referências
2. Para cada entrada, validar via MCPs configurados
3. Classificar: encontrada / não encontrada / suspeita
4. Calcular score geral
5. Gerar certidão

## Classificação

| Score | Status | Impacto |
|-------|--------|---------|
| 90-100 | Verificada | Nenhum |
| 70-89 | Confirmada parcial | Nota máxima 8.0 |
| 50-69 | Suspeita | Nota máxima 6.0 |
| 0-49 | Não encontrada | Nota máxima 4.0 |
