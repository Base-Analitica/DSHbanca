# Visão Geral do Projeto

> **Documento histórico.** Esta página descreve o protótipo OpenBanca para o OpenCode e **não representa o DSHbanca atual nem a arquitetura DSH-only**. Para o estado vigente, consulte o [README](../README.md), a [arquitetura](architecture.md), a [instalação](installation.md) e o [guia de uso](usage.md). Menções a OpenCode, comandos `/banca:*`, MCPs e `opencode.json` são registro histórico **não suportado**.

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

## Como o protótipo se encaixava no uso com OpenCode (histórico)

O OpenBanca se integrava ao OpenCode como:

1. **Ferramentas (Tools)**: 15 ferramentas que podem ser chamadas via comandos `/banca:*`
2. **Agentes (Agents)**: 5 agentes especializados (auditor, corretor, fontes, integrador, loop)
3. **Skills**: 8 skills que orquestram workflows completos
4. **Comandos**: Comandos `/banca:*` que invocam as ferramentas

O plugin consumia MCPs já configurados no OpenCode (crossref-academic, semantic-scholar, pubmed) para validação de referências, mas não empacotava nem configurava esses MCPs. **Esclarecimento atual:** o DSHbanca não consome MCPs para validar referências. O DSH é dono de MCP, rede e lifecycle de integrações; [`banca_refs`](../src/tools/banca_refs.ts) faz parsing BibTeX local, reutiliza o cache `.banca/cache/refs.json` e marca como `bloqueada` (`external_transport_blocked`) a referência sem resultado positivo em cache, pois não há provedor nativo de referências na versão observada do DSH. Ver [MCPs e integrações externas](mcps.md) e [guia de uso](usage.md).

## Arquitetura em Camadas (desenho histórico do OpenBanca)

Diagrama histórico do protótipo, mantido como registro: **não é a arquitetura atual do DSHbanca**. A separação de responsabilidades vigente está em [arquitetura](architecture.md).

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

## Estado do Projeto (registro histórico do protótipo)

> **Registro histórico do protótipo OpenBanca.** Não descreve o estado do DSHbanca atual e não deve ser lido como disponibilidade de MCP, OpenCode ou validação externa.

O protótipo registrava fase **experimental** (v0.1.0), com pendências como:

- compatibilidade com diferentes versões do OpenCode, hoje legado não suportado;
- teste de MCPs em ambiente real, que não é caminho operacional do DSHbanca atual;
- performance em trabalhos grandes, não medida;
- lacunas de documentação.

Limitações e riscos vigentes estão no [README](../README.md).

## Métricas de Qualidade (histórico do protótipo)

No desenho histórico, o plugin avaliava trabalhos acadêmicos em 4 eixos:

| Eixo | Peso | O que verifica |
|------|------|----------------|
| ABNT/Estrutura | 3 | Formatação, ficha catalográfica, elementos pré/pós-textuais |
| Citações/Fontes | 3 | Cobertura de parágrafos, qualidade das referências |
| Conteúdo/Lógica | 2 | Coerência metodológica, resultados, discussão |
| Estilo Acadêmico | 2 | Redação, metacomentários, marcas de IA |

A nota final do protótipo era calculada com um sistema de "travas" que limitava a nota máxima quando problemas críticos eram detectados. Esse desenho é registro histórico; consulte o [README](../README.md) para limitações e riscos vigentes.
