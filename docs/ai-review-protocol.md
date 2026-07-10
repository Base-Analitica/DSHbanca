# Protocolo de Revisão por IA

## Objetivo

Este documento define o protocolo para revisão deste repositório por modelos de IA. O objetivo é avaliar:

- **Clareza**: O projeto é fácil de entender e usar?
- **Segurança**: Há riscos de segurança ou exposição de dados?
- **Utilidade**: O projeto resolve um problema real?
- **Compatibilidade**: O plugin funciona com o OpenCode?
- **Qualidade dos prompts/skills**: Os prompts são eficazes e seguros?
- **Documentação**: A documentação é completa e clara?
- **Manutenção**: O projeto é fácil de manter e evoluir?

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

## Formato da Revisão

### Resumo Executivo

Breve resumo do estado geral do projeto em três a cinco linhas.

### Pontos Fortes

O que o projeto faz bem, citando exemplos específicos.

### Problemas Críticos

Problemas que impedem uso, causam danos ou invalidam resultados centrais. Exemplos:

- segurança comprometida;
- funcionalidade principal quebrada;
- dados expostos;
- auditoria analisando conteúdo incompleto;
- decisão central baseada em cálculo impossível.

### Problemas Importantes

Problemas que afetam usabilidade, confiabilidade ou qualidade. Exemplos:

- documentação incorreta;
- código difícil de manter;
- falta de testes essenciais;
- permissões não aplicadas;
- heurísticas apresentadas como prova.

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

Arquivos presentes, build aprovado ou testes unitários isolados não provam, por si só, integração real com OpenCode, MCP, LaTeX ou GitHub Actions.

## Prompts Disponíveis

Use os prompts na pasta `prompts/` para diferentes tipos de revisão:

| Prompt | Foco |
|---|---|
| `ai-reviewer-general.md` | Revisão abrangente |
| `ai-reviewer-code.md` | Código e estrutura |
| `ai-reviewer-docs.md` | Documentação |
| `ai-reviewer-security.md` | Segurança |

## Exemplo resumido de finding

```markdown
## P1 — Processo MCP pode permanecer vivo após erro

**Área:** referências e segurança  
**Evidência:** `src/lib/provider_chain.ts` cria o cliente fora de um bloco com encerramento garantido.  
**Impacto:** processos órfãos, timeouts e fallback silencioso.  
**Labels:** `bug`, `priority:p1`, `area:references`, `area:security`, `needs:e2e`.  
**Aceite:** processo encerrado em sucesso, erro e timeout; teste mockado e validação integrada registradas.
```
