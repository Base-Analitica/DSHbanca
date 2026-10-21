# Protocolo de Revisão por IA

## Objetivo

Este documento define o protocolo para revisão deste repositório por modelos de IA. O DSHbanca é um plugin acadêmico cujo **único harness é o DSH (DeepSeek Harness)**, integrado nativamente por Cordis. O [OpenBanca](https://github.com/Base-Analitica/openbanca) é um projeto separado, voltado ao OpenCode. O objetivo da revisão é avaliar:

- **Clareza**: O projeto é fácil de entender e usar?
- **Segurança**: Há riscos de segurança ou exposição de dados?
- **Utilidade**: O projeto resolve um problema real?
- **Integração DSH/Cordis**: O plugin respeita o contrato nativo do DSH instalado, sem criar runtime paralelo, roteador de modelos, sessão própria ou segundo harness?
- **Integridade acadêmica**: Cobertura, proveniência, findings e proteções acadêmicas estão preservados?
- **Qualidade dos prompts/skills**: Os prompts são eficazes e seguros?
- **Documentação**: A documentação é completa e clara?
- **Manutenção**: O projeto é fácil de manter e evoluir?

Menções a OpenCode neste repositório são **legado histórico em migração**. Elas não são critério de aceite, não definem o runtime e não devem orientar a revisão. Avalie o contrato do DSH/Cordis efetivamente instalado no SHA revisado, não afirmações de documentação de outro harness nem de código legado.

## Regras para a IA Revisora

1. **Não invente funcionalidades** — avalie apenas o que existe no código.
2. **Cite arquivos e trechos específicos** — não faça afirmações genéricas.
3. **Separe problemas por gravidade** — use a política oficial de prioridade.
4. **Sugira correções práticas** — não apenas aponte problemas.
5. **Não reescreva tudo sem necessidade** — respeite a intenção original.
6. **Preserve a intenção do autor** — melhore, não substitua.
7. **Identifique riscos de segurança** — tokens, caminhos e comandos perigosos.
8. **Identifique ambiguidades** — onde o comportamento é incerto.
9. **Identifique oportunidades de simplificação** — código desnecessário.
10. **Entregue um relatório objetivo** — sem rodeios e direto ao ponto.
11. **Não declare validação que não ocorreu** — diferencie inspeção, teste automatizado e execução real.
12. **Não tome decisões humanas silenciosamente** — marque escolhas de produto, política ou arquitetura.
13. **Não promova evidência** — classifique cada conclusão pela [hierarquia de evidências](#hierarquia-de-evidencias) e trate a etapa não provada como não provada.
14. **Não crie infraestrutura de host** — runtime, sessões, permissões, modelos, MCPs e dispatch pertencem ao DSH; o DSHbanca permanece no domínio acadêmico.
15. **Não invente APIs nem evidência do DSH** — se o contrato não puder ser verificado, registre `BLOCKED` em vez de presumir.

## Cadeia de verificação da integração DSH/Cordis

Uma capacidade nativa só pode ser declarada provada quando a etapa correspondente foi observada. Cada etapa exige evidência própria e não é herdada da anterior:

| Etapa | O que é | Evidência necessária | Não comprova |
|---|---|---|---|
| 1. Arquivo ou código existente | O módulo ou asset está no repositório | Inspeção do arquivo no SHA revisado | Registro, discovery, associação ou execução |
| 2. Registro declarado pelo plugin | O plugin chama a API de registro nativa (por exemplo `ctx.tools.register` ou `ctx.skills.registerProvider`) | Código no SHA + contrato da API conferido na versão instalada | Que o DSH carregou o plugin ou descobriu o item |
| 3. Discovery pelo DSH real | O host listou a tool, skill ou agent | Execução no DSH real, registrada com SHA e versão | Associação ao Agent ou à Session corretos |
| 4. Associação a Agent/Session nativos | O item aparece no contexto do Agent/sessão pretendido | Observação no host | Dispatch, enforcement ou comportamento |
| 5. Dispatch e enforcement de permissões | O host executou a tool e aplicou guard ou negativa antes da mutação | E2E DSH sem modelo, com argumentos válidos, classificação da negativa e teardown | Qualidade da resposta ou julgamento acadêmico |
| 6. Comportamento dependente de modelo | O modelo produziu o comportamento esperado | E2E com modelo **autorizado**, com modelo, configuração e finalidade registrados | Generalização para outros modelos ou projetos |

Regras da cadeia:

- Arquivo presente, nome conhecido, hash igual, preset vazio ou cópia instalada não passam da etapa 1.
- Sem E2E no SHA final, a integração permanece **não comprovada**. CI convencional, build, mock e resultado de outro SHA não substituem esse gate.
- Antes de aceitar infraestrutura nova, o revisor deve exigir as respostas host-first: qual versão do DSH/Cordis foi inspecionada; qual API nativa foi verificada; qual lacuna concreta do host foi reproduzida; por que a solução pertence ao domínio acadêmico; como o escopo impede um segundo harness; qual evidência E2E no SHA final comprova a necessidade; e quem possui lifecycle, ambiente, credenciais e plano de remoção.
- Sem lacuna concreta e reproduzida no host, a implementação deve usar a API nativa do DSH. Se o contrato não for verificável, o resultado é `BLOCKED`.

## Hierarquia de evidências

| Nível | Comprova | Não comprova |
|---|---|---|
| Inspeção estática | Presença, texto e contrato declarado naquele SHA | Execução ou descoberta pelo host |
| Typecheck e build | Tipos e compilação naquele SHA | Correção funcional ou integração |
| Testes unitários | Comportamento isolado coberto pelo teste | Host real |
| Fixtures e mocks | Contrato simulado e casos controlados | DSH/Cordis real |
| E2E DSH real sem modelo | Discovery, lifecycle, associação, dispatch e enforcement observados | Inferência, qualidade de resposta ou juízo acadêmico |
| E2E DSH com modelo autorizado | Comportamento dependente do modelo na configuração registrada | Generalização para outros modelos, projetos ou SHAs |
| Compilação LaTeX/BibTeX real | Compilação de documentos e resolução de referências | Qualidade acadêmica, conformidade ABNT ou nota |
| Avaliação acadêmica humana | Juízo acadêmico e decisão institucional | Automação; não é substituível por heurística, índice ou scoring |

Regras da hierarquia:

- Não promova evidência inferior a categoria superior. Registre `PASS`, `FAIL` ou `BLOCKED` por gate.
- E2E de integração DSH deve ser observado no SHA final quando a alegação depender dele.
- Este protocolo **não autoriza executar** E2E, modelo, credenciais ou OpenCode. Revisão documental não produz E2E real.
- Detector de IA e similaridade são sinais metodológicos, não prova de autoria. Índice interno ou scoring não é nota institucional.

## Integridade acadêmica

A revisão deve sinalizar violações de:

- cobertura integral obrigatória antes de síntese ou nota conclusiva;
- proveniência de findings por plano, lote, fingerprint e arquivo/linha;
- invenção de DOI, fonte, citação, linha ou trecho;
- auditor read-only e enforcement de permissão **antes** de qualquer mutação;
- correção aplicada sem autorização humana específica;
- snapshot declarado restaurável sem prova de reversibilidade;
- detector de IA tratado como prova de autoria;
- índice interno ou scoring tratado como aprovação ou reprovação acadêmica.

Esta revisão **não altera rubricas** nem define novos critérios de aprovação acadêmica. Mudanças de rubrica, scoring, identidade, permissões ou trust model exigem decisão humana registrada antes da implementação.

## Triagem e labels de issues

Antes de criar, editar, priorizar ou fechar um issue, o agente deve ler:

- [Política de labels para issues](issue-labeling-policy.md);
- [Fonte estruturada dos labels](../.github/labels.yml);
- [Instruções gerais para agentes](../AGENTS.md).

Todo issue aberto deve possuir:

- exatamente um tipo: `bug`, `enhancement` ou `documentation`;
- exatamente uma prioridade: `priority:p0`, `priority:p1`, `priority:p2` ou `priority:p3`;
- uma ou duas áreas `area:*`;
- labels operacionais somente quando os critérios documentados forem atendidos.

### Regras obrigatórias

1. Não inventar labels.
2. Não aplicar duas prioridades.
3. Não aplicar mais de duas áreas.
4. Não alterar prioridade sem comentário com evidência e impacto residual.
5. Usar `needs:human-decision` quando houver escolha não resolvida.
6. Usar `needs:e2e` quando mocks e testes unitários não forem evidência suficiente.
7. Aplicar `agent:ready` somente quando os critérios de aceite forem executáveis sem nova decisão.
8. Aplicar `agent:blocked` somente com comentário que identifique o bloqueio e a condição de desbloqueio.
9. Não fechar issue marcado `needs:e2e` sem evidência da execução real.
10. Não fechar issue marcado `needs:human-decision` enquanto a decisão não estiver registrada.

A taxonomia vigente ainda contém nomenclatura legada de outro harness (por exemplo `area:opencode`), assim como `docs/issue-labeling-policy.md`, `.github/labels.yml` e os arquivos de `prompts/` contêm exemplos herdados. A migração dessa nomenclatura é **dívida documental separada**: não renomeie labels, não crie taxonomia paralela e não altere esses arquivos por conta desta revisão.

## Formato da Revisão

### Resumo Executivo

Breve resumo do estado geral do projeto em três a cinco linhas.

### Pontos Fortes

O que o projeto faz bem, citando exemplos específicos.

### Problemas Críticos

Problemas que impedem uso, causam danos ou invalidam resultados centrais. Exemplos:

- segurança comprometida;
- funcionalidade principal quebrada;
- dados ou manuscrito expostos;
- auditoria ou síntese conclusiva emitida sobre cobertura incompleta;
- enforcement de permissão contornado antes da mutação;
- decisão central baseada em cálculo impossível.

### Problemas Importantes

Problemas que afetam usabilidade, confiabilidade ou qualidade. Exemplos:

- documentação incorreta;
- código difícil de manter;
- falta de testes essenciais;
- permissões não aplicadas;
- heurística apresentada como prova;
- instrução Markdown tratada como controle de acesso;
- integração DSH declarada sem evidência de discovery ou dispatch.

### Melhorias Opcionais

Sugestões que melhorariam o projeto, mas não são urgentes.

### Riscos de Segurança

Lista de riscos de segurança encontrados, classificados por gravidade e com evidência.

### Problemas de Documentação

Lacunas, divergências ou afirmações sem validação.

### Sugestões de Estrutura

Melhorias na organização do repositório e redução de duplicidade.

### Arquivos que Precisam de Atenção

Lista de arquivos que requerem revisão específica.

### Próximas Ações Recomendadas

Lista priorizada de ações, incluindo dependências e validações necessárias.

## Requisitos para criação de issues

Quando a revisão identificar um problema acionável, o issue deve conter, quando aplicável:

1. resumo;
2. evidência no repositório;
3. impacto;
4. severidade justificada;
5. direção de correção;
6. critérios de aceite;
7. testes necessários;
8. arquivos prováveis;
9. restrições e ações que não devem ser feitas.

O título deve descrever o problema. A prioridade deve ser representada pelo label; prefixos de prioridade existentes podem permanecer durante a migração.

## Requisitos para fechamento

O comentário de fechamento deve registrar:

- o que mudou;
- commit ou PR relevante;
- testes executados;
- itens não validados;
- limitações restantes;
- issues de acompanhamento.

Arquivos presentes, build aprovado ou testes unitários isolados não provam, por si só, integração real com o DSH, MCP, LaTeX ou GitHub Actions. Somente E2E real no DSH, no SHA final, comprova os comportamentos nativos observados; mock, CI convencional e resultado de outro SHA não substituem esse gate.

Uma correção puramente documental pode ser encerrada com revisão editorial, diff restrito e CI do SHA final, **sem** alegar integração DSH. Integração declarada sem a etapa correspondente da cadeia de verificação permanece não comprovada.

## Prompts Disponíveis

Use os prompts na pasta `prompts/` para diferentes tipos de revisão:

| Prompt | Foco |
|---|---|
| `ai-reviewer-general.md` | Revisão abrangente |
| `ai-reviewer-code.md` | Código e estrutura |
| `ai-reviewer-docs.md` | Documentação |
| `ai-reviewer-security.md` | Segurança |

Os prompts são auxiliares e ainda podem conter referências herdadas de outro harness; isso é dívida documental separada e não altera os critérios de aceite deste protocolo.

## Exemplo resumido de finding

Exemplo **ilustrativo de formato**, não uma descrição confirmada do código atual:

```markdown
## P1 — Síntese global emitida com cobertura incompleta

**Área:** auditoria e correção
**Evidência:** a entrada de síntese em `src/lib/analysis_synthesis.ts` exige cobertura completa; conferir o gate no SHA revisado e registrar arquivo/linha.
**Impacto:** conclusão acadêmica sobre manuscrito parcialmente analisado.
**Labels:** `bug`, `priority:p1`, `area:audit`, `needs:e2e`.
**Aceite:** síntese bloqueada sem cobertura integral e fingerprint; teste unitário do gate e observação no DSH no SHA final registrados como evidências distintas.
```

## Referências normativas

- [Instruções gerais para agentes](../AGENTS.md)
- [Arquitetura do DSHbanca](architecture.md)
- [Fluxo de agentes no terminal](terminal-agent-workflow.md)
- [Política de labels para issues](issue-labeling-policy.md) e [fonte estruturada dos labels](../.github/labels.yml) — taxonomia vigente; a nomenclatura legada será tratada em migração separada.
