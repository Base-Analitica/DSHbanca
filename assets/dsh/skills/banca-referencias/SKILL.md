---
name: banca-referencias
description: Valida referências bibliográficas do texto contra bases de dados acadêmicas.
---
# Skill: Banca Referências

Valida referências do texto acadêmico com o contrato fail-closed do DSHbanca: parsing local completo e evidência apenas do cache positivo. Não há busca externa, transporte próprio nem rede.

## Quando usar
Para extrair e classificar as referências de um arquivo `.bib` ou da seção de Referências do trabalho, de forma determinística e offline.

## Quando NÃO usar
Não use para afirmar existência em bases externas, autenticidade de fonte ou certificação de referências; não use para avaliar qualidade, pertinência temática ou adequação da referência ao estudo.

## Entradas necessárias
- Caminho para o diretório ou arquivo `.bib` ou `Referências`.
- Cache local de referências com evidência positiva já armazenada (`.banca/cache`), quando existir.

## Ferramentas permitidas
- `banca_refs`

## Protocolo
1. Executar `banca_refs` para parsear as referências. O parsing é tudo-ou-nada: entrada malformada ou constructo não suportado interrompe a execução com erro de parsing, sem relatório parcial.
2. Consultar somente o cache positivo local. Não iniciar MCP, REST, subprocesso ou qualquer transporte de rede.
3. Classificar cada referência conforme a evidência disponível:
   - `verificada`: existe cache positivo com metadados; é evidência armazenada, não validação externa realizada nesta execução.
   - `bloqueada`: não há cache positivo. Registrar `external_transport_blocked`, sem tratar a referência como inexistente.
   - `parcial` ou `nao_encontrada`: somente quando a própria evidência armazenada sustentar o estado; nunca inferir por ausência de rede.
4. Reportar `Evaluated: N/total`, `Verified`, `Blocked (no DSH provider)` e a média apenas das referências avaliadas; usar `N/A` quando nenhuma foi avaliada.
5. Apresentar a contagem por provider (`cache`, `none`) e os limites da execução.

## Formato da saída
Um relatório Markdown em `.banca/reports/` com título "Reference Validation", tabela por referência (chave, score, status, provider, evidência) e resumo de avaliadas e bloqueadas. É um relatório de evidência e limites; não é documento de certificação de fontes nem parecer de integridade acadêmica.

## Limites e nível de confiança
O cache positivo pode estar desatualizado ou ter sido validado em outro contexto; ele não prova existência atual em base externa. Ausência de cache é indisponibilidade de transporte, não indício de referência falsa. Não há verificação de DOI, ISBN ou metadados contra fonte externa enquanto o DSH instalado não oferecer provider nativo de referências.

## Situações que exigem confirmação humana
Muitas referências bloqueadas indicam ausência de provider nativo ou cache vazio, não problema acadêmico. O autor deve revisar manualmente qualquer decisão sobre validade; a skill não emite julgamento.

## Relação com a rubrica ativa
Não altera rubrica, scoring, nota, aprovação ou reprovação. Referências bloqueadas ficam fora da média; não aplique punição por bloqueio nem por ausência de cache.

## Comportamento quando as evidências forem insuficientes
Sem cache positivo, a referência permanece `bloqueada` com `external_transport_blocked`. Nunca classifique como inexistente ou aplique punição sem evidência armazenada.
