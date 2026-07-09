# Visão Geral do Projeto

## O que é o OpenBanca

O OpenBanca é um plugin para o OpenCode que fornece ferramentas especializadas para gestão, auditoria e correção de trabalhos acadêmicos. Ele foi projetado para automatizar partes do processo de revisão de monografias, dissertações e TCCs.

## Problema que resolve

Escrever um trabalho acadêmico de qualidade envolve múltiplos aspectos:
- Formatação according ABNT (NBR 10520, NBR 6023, NBR 14724)
- Cobertura adequada de citações em todos os parágrafos
- Coerência lógica entre metodologia, resultados e conclusão
- Estilo acadêmico (evitar metacomentários, marcas de IA, etc.)
- Validação de referências bibliográficas

O OpenBanca automatiza a verificação desses aspectos e fornece um sistema de correção contínua com proteção contra alterações indevidas.

## Como o plugin se encaixa no uso com OpenCode

O OpenBanca se integra ao OpenCode como:

1. **Ferramentas (Tools)**: 15 ferramentas que podem ser chamadas via comandos `/banca:*`
2. **Agentes (Agents)**: 5 agentes especializados (auditor, corretor, fontes, integrador, loop)
3. **Skills**: 8 skills que orquestram workflows completos
4. **Comandos**: Comandos `/banca:*` que invocam as ferramentas

O plugin consome MCPs já configurados no OpenCode (crossref-academic, semantic-scholar, pubmed) para validação de referências, mas não empacota nem configura esses MCPs.

## Arquitetura em Camadas

```
┌─────────────────────────────────────────────────────┐
│                    OpenCode                          │
├─────────────────────────────────────────────────────┤
│  Agents    │    Skills    │    Commands              │
│  (5)       │    (8)       │    (/banca:*)            │
├─────────────────────────────────────────────────────┤
│                   Tools (15)                        │
│  banca_init, banca_auditar, banca_corrigir, ...     │
├─────────────────────────────────────────────────────┤
│              Libraries (lib/)                        │
│  config, state, reports, paths, guards, ...         │
├─────────────────────────────────────────────────────┤
│                    MCPs                             │
│  crossref-academic, semantic-scholar, pubmed        │
└─────────────────────────────────────────────────────┘
```

## Tipos de IA que podem revisar o projeto

O repositório foi preparado para revisão por diferentes tipos de IA:

1. **IA Geral** (ex: Claude, GPT-4, Gemini): Revisão abrangente do projeto
2. **IA de Código** (ex: GitHub Copilot, Cursor): Revisão de estrutura e scripts
3. **IA de Documentação** (ex: Grammarly, LanguageTool): Revisão de textos
4. **IA de Segurança** (ex: Snyk, Trivy): Auditoria de segurança

Consulte `prompts/` para prompts prontos para cada tipo de revisão.

## Estado do Projeto

O projeto está em fase **experimental/protótipo** (v0.1.0). As principais funcionalidades estão implementadas, mas:

- A compatibilidade com diferentes versões do OpenCode precisa ser validada
- Os MCPs precisam ser testados em ambiente real
- A performance em trabalhos grandes não foi medida
- A documentação pode ter lacunas

## Métricas de Qualidade

O plugin avalia trabalhos acadêmicos em 4 eixos:

| Eixo | Peso | O que verifica |
|------|------|----------------|
| ABNT/Estrutura | 3 | Formatação, ficha catalográfica, elementos pré/pós-textuais |
| Citações/Fontes | 3 | Cobertura de parágrafos, qualidade das referências |
| Conteúdo/Lógica | 2 | Coerência metodológica, resultados, discussão |
| Estilo Acadêmico | 2 | Redação, metacomentários, marcas de IA |

A nota final é calculada com um sistema de "travas" que limita a nota máxima quando problemas críticos são detectados.
