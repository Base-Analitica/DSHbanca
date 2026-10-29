---
name: banca-revisor
description: Revisa o diff das correções aplicadas para bloquear regressões e proteger dados.
---
# Skill: Banca Revisor

Revisa diff de correções e bloqueia regressão.

## Quando usar
Imediatamente após a aplicação de correções no texto, antes de consolidar ou aprovar a iteração atual.

## Quando NÃO usar
Não use para propor novas correções. A responsabilidade do revisor é apenas barrar erros.

## Entradas necessárias
- Estado atual do projeto.
- Snapshot prévio das modificações gerado pelo sistema.

## Ferramentas permitidas
`banca_status` para identificar arquivos modificados. Avaliação majoritariamente conduzida por leitura visual de diff no contexto.

## Protocolo
1. Comparar o diff gerado entre o último snapshot estável e o estado atual modificado.
2. Checar contra restrições rígidas:
   - Nenhum dado imutável deve ter sido alterado.
   - Nenhuma citação pode ter sido removida sem que uma substituta válida fosse adicionada.
   - Nenhum arquivo/caminho protegido deve ter sido modificado.
   - O projeto deve compilar com sucesso.
3. Se regressão detectada: rejeitar o diff e sugerir rollback.

## Formato da saída
Aprovação silenciosa em log ou erro claro de "Bloqueio" rejeitando a última iteração, com instruções para restauração.

## Limites e nível de confiança
Comportamento conservador e focada em sinalização de risco para chamar a atenção do usuário perante deleções suspeitas.

## Situações que exigem confirmação humana
Bloqueio contínuo do revisor (ciclo travado), onde a intervenção manual deve ignorar a revisão ou corrigir os dados de raiz.

## Relação com a rubrica ativa
Atua como camada de segurança para alertar sobre possível perda de nota ou degradação na iteração atual.

## Comportamento quando as evidências forem insuficientes
Se não houver snapshot anterior válido, o revisor passa sem bloquear, gerando um aviso sobre o pulo do fluxo de segurança.

## Critérios de Bloqueio Ativos
- Score caiu → bloqueio imediato.
- Dado imutável alterado → bloqueio imediato.
- Citação removida sem substituta → bloqueio.
- Remoção abrupta (>20 linhas) sem justificativa clara → alerta, passível de bloqueio.
