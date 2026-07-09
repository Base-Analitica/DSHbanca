# Skill: Banca Correção

Aplica correções no manuscrito com snapshot, contrato e validação.

## Ativação

Invocar agente `@banca-corretor`.

## Protocolo

1. Carregar relatório de auditoria
2. Classificar cada achado:
   - **Auto**: aplicar direto
   - **Entrevistar**: perguntar ao usuário
   - **Pular**: ignorar
3. Criar snapshot (`banca_snapshot`)
4. Aplicar correções (`banca_corrigir`)
5. Compilar (`banca_compile`)
6. Revisar diff
7. Atualizar scorecard

## Imutáveis

- Dados experimentais primários
- Resultados estatísticos
- Identificadores (CEUA, DOI)
- Caminhos protegidos

## Matriz de Decisão

| Confiança | Impacto | Ação |
|-----------|---------|------|
| Alta | Baixo | Auto |
| Alta | Alto | Entrevistar |
| Baixa | Baixo | Pular |
| Baixa | Alto | Entrevistar |
