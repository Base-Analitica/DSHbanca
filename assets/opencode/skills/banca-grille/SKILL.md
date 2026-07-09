# Skill: Banca Grille

Entrevista exaustiva com usuário antes de executar correções complexas.

## Ativação

Invocar agente `@banca-grille` ou automaticamente quando decisão = "Entrevistar".

## Protocolo

1. Apresentar contexto do achado
2. Perguntar:
   - Escopo: quais arquivos/seções corrigir?
   - Imutáveis: o que NÃO pode mudar?
   - Tolerância: qual nota alvo?
3. Salvar respostas no contexto da iteração
4. Só prosseguir quando todas as respostas forem claras
