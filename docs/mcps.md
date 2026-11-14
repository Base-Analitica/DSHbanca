# MCPs e integrações externas

Página reconciliada com o contrato DSH-only do HEAD `f6786df` (issue #122). Ela descreve o lugar de MCPs e integrações com provedores externos no DSHbanca; não é guia de configuração de MCP.

## Governança: o DSH é o único harness

MCPs, rede, processos filhos e integrações com provedores externos pertencem ao **DSH (DeepSeek Harness)**, único harness do projeto, não ao plugin. Lifecycle, ambiente, credenciais e política de acesso dessas integrações são responsabilidade do host ([AGENTS.md](../AGENTS.md), [arquitetura](architecture.md)).

O DSHbanca não empacota, não configura, não registra e não inicia cliente MCP, servidor próprio ou subprocesso de transporte. Não há auto-registro de MCP, fallback REST ou transporte externo implementado pela ferramenta de referências.

## O que `banca_refs` faz

[`banca_refs`](../src/tools/banca_refs.ts) é a ferramenta de referências do repositório. O contrato verificado em código e em testes herméticos é:

1. Lê o `.bib` configurado em `manuscript.bib` e faz parsing BibTeX local e determinístico ([gramática suportada](bibtex-parser-grammar.md)).
2. Reutiliza evidência armazenada em `.banca/cache/refs.json` ([`cache.ts`](../src/lib/cache.ts)), por chave exata e por DOI (case-insensitive).
3. Sem resultado positivo no cache, marca a referência como `bloqueada` (provider `none`, `matchedBy: none`, score 0, erro `external_transport_blocked`), porque não há provedor nativo de referências na versão observada do DSH (`0.2.0-rc.2`). Esse caminho não chama `fetch`, não inicia `McpClient` e não executa `spawn` ([`provider_chain.ts`](../src/lib/provider_chain.ts)).
4. Grava relatório em `.banca/reports/refs-<timestamp>.md` com providers usados, evidências e limitações. A ferramenta apenas lê o cache: não grava, não atualiza e não consulta fonte externa.

Resultado positivo em cache é evidência armazenada reutilizada e **não** comprova consulta externa atual, atualidade ou autenticidade. Referência `bloqueada` não é `nao_encontrada` e não prova que a referência seja falsa; bloqueadas ficam fora da média. Veja a interpretação por cenário no [guia de uso](usage.md) e no [troubleshooting](troubleshooting.md).

## Nenhuma integração externa comprovada

Nenhuma integração nativa com Crossref, OpenAlex, PubMed ou Semantic Scholar está comprovada neste repositório. Uma integração futura de validação externa exigiria API do DSH confirmada para o host, autorização humana específica (dados, custos e credenciais) e E2E DSH real no SHA final. Isso não é prometido nem presumido por esta documentação.

## Legado histórico (não suportado)

Os itens abaixo são registro histórico do harness anterior (OpenCode/OpenBanca). Não são instruções operacionais, não habilitam transporte em `banca_refs` e não devem ser usados para tentar "desbloquear" referências:

- pacote `@opencode/banca` e arquivo de configuração `opencode.json`;
- lista de MCPs "recomendados" do protótipo (crossref-academic, semantic-scholar, pubmed, openalex);
- campos preservados por compatibilidade em `.banca/project.json`, migrados por `loadConfig`: `providers.references` (defaults `primary: mcp:crossref-academic`, `fallbacks: ["rest:crossref", "cache"]`, `timeoutMs: 20000`) e `mcp.crossrefAcademicEnabled` (default `false`);
- flags `OPENBANCA_ENABLE_CROSSREF_MCP` e `DSHBANCA_ENABLE_CROSSREF_MCP`, e o helper `getMcpCommand()` de [`config.ts`](../src/lib/config.ts), sem call site no fluxo atual;
- o comando `uvx --from crossref-academic-mcp-server crossref-server` retornado por esse helper.

Esses campos existem apenas por compatibilidade com configurações antigas e não são consultados pelo fluxo atual. Nenhum deles registra MCP, inicia processo, aciona fallback REST ou altera o status `bloqueada`. A existência de código legado não o torna caminho recomendado; transporte externo, se vier a existir, pertence ao DSH.
