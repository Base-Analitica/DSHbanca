---
name: banca-grille
description: Executa decisão acadêmica estruturada com o autor via perguntas nativas do DSH antes de prosseguir com propostas de correção.
---
# Skill: Banca Grille

Decisão acadêmica estruturada com o autor utilizando capacidades nativas de perguntas do DeepSeek Harness (DSH).

## Quando usar
Sempre que uma deliberação acadêmica ou proposta de correção esbarrar na Matriz de Decisão sob a categoria "Entrevistar" (alto risco, ambiguidade metodológica, trade-offs conceituais ou caminhos restritos legitimamente reservados ao autor).

## Quando NÃO usar
- Não use para correções triviais ou problemas que possam ser resolvidos objetivamente sem juízo humano.
- Não use quando não existirem evidências suficientes para fundamentar as alternativas.
- Não use como meio para obter autorização automática de correção ou mutação do manuscrito.

## Entradas necessárias
- Finding ou achado acadêmico estruturado (identificador, arquivo, linha ou seção).
- Evidências concretas extraídas do manuscrito ou referências bibliográficas.
- Alternativas metodológicas ou conceituais examináveis.

## Ferramentas permitidas
- `ask_user_question` — ferramenta nativa do DSH (canal `ctx.userQuestions`) para apresentar perguntas com alternativas selecionáveis e receber deliberações do autor.
- A skill atua exclusivamente no nível de interação e orientação deliberativa. NÃO executa ferramentas mutantes (`banca_corrigir`, `banca_restore`) nem altera arquivos diretamente.

## Protocolo
1. **Investigação e evidências**: O agente investiga o achado acadêmico e reúne as evidências concretas disponíveis (trechos, seções, citações).
2. **Avaliação da legitimidade da decisão**: Identifica se a questão é uma decisão legitimamente reservada ao autor. Se o problema tiver solução unívoca e objetiva, não formula pergunta desnecessária.
3. **Formulação de alternativas estruturadas**: Elabora normalmente entre 2 e 4 alternativas concretas e distintas. Cada alternativa deve conter:
   - Descrição objetiva da abordagem.
   - Consequência esperada no trabalho acadêmico.
   - Riscos ou limitações metodológicas relevantes.
   - Fundamentação nas evidências disponíveis.
4. **Recomendação fundamentada**: Quando houver base técnica e normativa suficiente, identifica explicitamente a opção recomendada, posicionando-a em primeiro lugar e anexando `(Recommended)` ao rótulo da opção, com justificativa clara da recomendação.
5. **Controles seguros obrigatórios**:
   - **Não sei / mostrar evidências**: Explicar a dúvida, as evidências e os riscos antes de exigir uma decisão do autor.
   - **Adiar / continuar outras etapas**: Preservar a pendência no estado acadêmico e continuar apenas trabalhos independentes e seguros, sem bloquear o fluxo.
   - **Outro**: Permitir resposta textual personalizada quando o autor desejar formular um direcionamento próprio (suportado nativamente pelo campo `custom`).
6. **Apresentação via ferramenta nativa**: Submete a pergunta estruturada chamando `ask_user_question`. O autor pode selecionar uma alternativa sem precisar digitar.
7. **Interpretação estrita como orientação**: O sistema interpreta a escolha exclusivamente como orientação para investigação e preparação de proposta examinável.
8. **Regra obrigatória de segurança (Não-mutação)**:
   - **Selecionar uma alternativa NÃO autoriza corrigir o manuscrito.**
   - O resultado permitido é investigar a questão, organizar evidências e preparar uma proposta examinável (ou diff proposto).
   - O resultado NÃO permitido é chamar automaticamente `banca_corrigir` ou `banca_restore`, interpretar a escolha como `allowed-once`, fabricar aprovação ou conceder permissões mutantes.
   - Qualquer mutação posterior exige aprovação nativa independente (`ctx.approval`) associada ao changeset concreto.
   - O perfil `banca-auditor` permanece estritamente read-only.

## Formato da saída
Repasse de orientação deliberativa clara e estruturada para a etapa subsequente de planejamento ou preparação de proposta examinável.

## Limites e nível de confiança
Alta confiabilidade fundamentada na deliberação direta do autor (human-in-the-loop), sem perda de rastreabilidade e sem concessão implícita de autorização.

## Situações que exigem confirmação humana
Toda decisão acadêmica reservada ao autor envolvendo trade-offs de escopo, posicionamento teórico ou método de pesquisa.

## Relação com a rubrica ativa
Atua como filtro de segurança acadêmica para assegurar que diretrizes de conteúdo e autoria reflitam a vontade fundamentada do pesquisador antes de qualquer proposta de adequação.

## Comportamento quando as evidências forem insuficientes
Não apresentar alternativas fictícias nem inventar citações para preencher quantidade mínima. Registrar formalmente a limitação de evidências e solicitar esclarecimentos ou adiamento seguro.
