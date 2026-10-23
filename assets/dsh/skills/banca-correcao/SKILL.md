---
name: banca-correcao
description: Aplica correções no manuscrito utilizando snapshots e validação de compilação.
---
# Skill: Banca Correção

Aplica correções no manuscrito com snapshot, contrato e validação.

## Quando usar
Para aplicar modificações recomendadas ao código-fonte ou texto do projeto, especialmente após uma rodada de avaliação ou planejamento.

## Quando NÃO usar
Não use para reescrever capítulos inteiros sem aprovação prévia. Não use para formatar dados estatísticos ou resultados experimentais primários.

## Entradas necessárias
- Relatório de auditoria prévio.
- Plano de correções estruturado.

## Ferramentas permitidas
- `banca_snapshot`
- `banca_corrigir`
- `banca_compile`

## Protocolo
1. Carregar relatório de auditoria e plano.
2. Classificar cada achado (Auto, Entrevistar, Pular) usando a Matriz de Decisão.
3. Criar um snapshot de segurança com `banca_snapshot`.
4. Aplicar as correções com `banca_corrigir`.
5. Compilar para verificar a estabilidade com `banca_compile`.
6. Revisar o diff e atualizar o scorecard.

## Formato da saída
Alterações diretas nos arquivos e atualização do histórico de correções em `.banca/`.

## Limites e nível de confiança
Snapshots fornecem segurança permitindo a reversão de mudanças caso ocorram falhas, mas as compilações e re-auditorias são fundamentais para confirmar a ausência de regressões.

## Situações que exigem confirmação humana
- Confiança baixa e impacto alto para a correção.
- Alterações em caminhos protegidos ou seções que exigem revisão (Matriz de Decisão).

## Relação com a rubrica ativa
Atua para elevar o score nas dimensões em defasagem apontadas pelo scorecard, focando na conformidade ABNT e estrutural.

## Comportamento quando as evidências forem insuficientes
Em caso de falta de certeza sobre a correção, falhar para a categoria "Entrevistar" e não aplicar a alteração diretamente.

## Imutáveis (Guardrails)
- Dados experimentais primários.
- Resultados estatísticos.
- Identificadores (CEUA, DOI).
- Caminhos protegidos e seções blindadas.
