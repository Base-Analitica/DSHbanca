# Protocolo de Revisão por IA

## Objetivo

Este documento define o protocolo para revisão deste repositório por modelos de IA. O objetivo é avaliar:

- **Clareza**: O projeto é fácil de entender e usar?
- **Segurança**: Há riscos de segurança ou exposição de dados?
- **Utilidade**: O projeto resolve um problema real?
- **Compatibilidade**: O plugin funciona com o OpenCode?
- **Qualidade dos prompts/skills**: Os prompts são eficazes e seguros?
- **Documentação**: A documentação é completa e clara?
- **Manutenção**: O projeto é fácil de manuter e evoluir?

## Regras para a IA Revisora

1. **Não invente funcionalidades** — avalie apenas o que existe no código
2. **Cite arquivos e trechos específicos** — não faça afirmações genéricas
3. **Separe problemas por gravidade** — crítico, importante, opcional
4. **Sugira correções práticas** — não apenas aponte problemas
5. **Não reescreva tudo sem necessidade** — respeite a intenção original
6. **Preserve a intenção do autor** — melhore, não substitua
7. **Identifique riscos de segurança** — tokens, caminhos, comandos perigosos
8. **Identifique ambiguidades** — onde o comportamento é incerto
9. **Identifique oportunidades de simplificação** — código desnecessário
10. **Entregue um relatório objetivo** — sem rodeios, direto ao ponto

## Formato da Revisão

### Resumo Executivo

Breve resumo do estado geral do projeto (3-5 linhas).

### Pontos Fortes

O que o projeto faz bem. Citar exemplos específicos.

### Problemas Críticos

Problemas que impedem uso ou causam danos. Exemplos:
- Segurança comprometida
- Funcionalidade quebrada
- Dados expostos

### Problemas Important

Problemas que afetam usabilidade ou qualidade. Exemplos:
- Documentação incompleta
- Código difícil de manter
- Falta de testes

### Melhorias Opcionais

Sugestões que melhorariam o projeto mas não são urgentes.

### Riscos de Segurança

Lista de riscos de segurança encontrados, classificados por gravidade.

### Problemas de Documentação

Lacunas ou erros na documentação.

### Sugestões de Estrutura

Melhorias na organização do repositório.

### Arquivos que Precisam de Atenção

Lista de arquivos que requerem revisão específica.

### Próximas Ações Recomendadas

Lista priorizada de ações para melhorar o projeto.

## Prompts Disponíveis

Use os prompts na pasta `prompts/` para diferentes tipos de revisão:

| Prompt | Foco |
|--------|------|
| `ai-reviewer-general.md` | Revisão abrangente |
| `ai-reviewer-code.md` | Código e estrutura |
| `ai-reviewer-docs.md` | Documentação |
| `ai-reviewer-security.md` | Segurança |

## Exemplo de Revisão

```markdown
## Resumo Executivo

O OpenBanca é um plugin OpenCode bem estruturado para gestão de trabalhos acadêmicos.
O código é limpo e a documentação é razoável. Há problemas de segurança menores e
algumas lacunas na documentação.

## Pontos Fortes

- Estrutura de diretórios clara e lógica
- Sistema de guardrails bem implementado
- Testes abrangentes para funcionalidades críticas
- Documentação técnica detalhada

## Problemas Críticos

Nenhum problema crítico encontrado.

## Problemas Importantes

1. **Falta de LICENSE** (`LICENSE_PENDING.md`): O projeto não tem licença definida.
   - **Arquivo**: `LICENSE_PENDING.md`
   - **Impacto**: Impede uso público
   - **Sugestão**: Definir licença (MIT, Apache-2.0, etc.)

2. **MCP client sem tratamento de erro** (`src/lib/mcp_client.ts:45`):
   - **Problema**: Timeout não tratado corretamente
   - **Impacto**: Pode travar o plugin
   - **Sugestão**: Adicionar try/catch com timeout

## Melhorias Opcionais

1. Adicionar mais exemplos de uso
2. Criar script de setup automático
3. Adicionar linting e formatting

## Riscos de Segurança

- **Baixo**: Não há tokens ou credenciais expostos
- **Baixo**: Comandos LaTeX são executados via execSync (risco controlado)

## Próximas Ações Recomendadas

1. Definir licença
2. Adicionar CI/CD
3. Expandir testes
4. Melhorar exemplos de uso
```
