# Changelog

Todas as mudanças relevantes serão documentadas aqui.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/),
e este projeto adere ao [Semantic Versioning](https://semver.org/lang/pt-BR/).

## [Unreleased]

### Corrigido

- Runner E2E nativo DSH (`scripts/e2e-dsh-profile.ts`): compatibilidade com pnpm 12 nativo (`pnpm-native`) e entrypoints JavaScript (`.cjs`/`.mjs`), validação estrita de manifesto `package.json` (`name: "pnpm"`), confinamento de entrypoints, coerência de versão com cache, fail-closed e rejeição do dispatcher Corepack (#32).
- Integração nativa DSH registra as 16 ferramentas `banca_*`, com schemas, validação e diretório da sessão; catálogo compartilhado com OpenCode e regressão do bundle compilado.
- `banca_corrigir`: substituição agora usa `replaceAll` em vez de `replace` (string), que substituía apenas a primeira ocorrência — correções repetidas no manuscrito eram silenciosamente dropadas
- `banca_corrigir`: adicionado campo opcional `expectedOccurrences` no schema de correção; quando o count real difere do esperado, um warning `⚠` é emitido no resultado
- `banca_corrigir`: resultado agora reporta quantas substituições foram feitas por arquivo (`✓ file (N replacements)`)
- `provider_chain.ts`: `parseMcpResult` não usa mais `any` — substituído por interfaces tipadas (`McpResponse`, `McpResultItem`, `McpPaperDetails`) com coercion segura via `asString`/`asNumber`/`asStringArray`
- `provider_chain.ts`: `mcpResult` agora é `unknown` em vez de `any`; parsing de `content[]` text encapsulado em JSON é tratado explicitamente
- `config.ts`: import de `mkdirSync` movido para o topo do arquivo (estava solto no meio, linha 187)
- Documentação de instalação ajustada para refletir pacote ainda não publicado (`private: true`)
- Matriz de validação alinhada com testes realmente executados (nada marcado como testado sem evidência)
- Compilação LaTeX ajustada para evitar execução via shell string (`execSync` → `spawnSync` com args separados)
- Auto-registro do MCP crossref-academic tornado explícito/opt-in (requer `OPENBANCA_ENABLE_CROSSREF_MCP=1`)
- Script de verificação de segredos ajustado para reduzir falsos positivos (modo `--ci` ignora docs/prompts)

### Segurança

- E2E legado OpenCode deixa de iniciar no `bun test` padrão; execução de modelo e uso/cópia de credenciais exigem opt-ins separados e modelo explicitamente selecionado.
- Reduzido risco de execução shell na compilação LaTeX (validação de engines, argumentos separados)
- Auto-registro de dependência externa (crossref-academic via `uvx`) deixou de ser comportamento padrão
- Script check-secrets.sh: modo `--ci` detecta chaves reais sem falso positivo em documentação

### Alterado

- `src/lib/latex.ts`: `execSync` substituído por `spawnSync` com interface `LatexCommand`
- `src/tools/banca_compile.ts`: passos de compilação agora usam `LatexCommand[]` estruturado
- `src/index.ts`: auto-registro MCP protegido por variável de ambiente
- `scripts/check-secrets.sh`: dois modos (`--ci` e `--audit`)
- `docs/installation.md`: matriz de validação honesta, distinção local vs público
- `README.md`: seção de instalação corrigida
- `RELATORIO.md`: matriz de validação honesta
- `SECURITY.md`: seções de execução de comandos, MCPs e verificação de segredos

## [0.1.0] - 2025-01-XX

### Adicionado

- Plugin inicial para OpenCode
- 15 ferramentas para gestão de trabalhos acadêmicos
- Sistema de auditoria em 4 eixos
- Correção com guardrails
- Validação de referências via MCPs
- Detecção de padrões de IA
- Loop de correção contínua
- Snapshots para versionamento
- Compilação LaTeX
- Checklist de entrega
- 8 skills para workflows
- 5 agentes especializados
- Testes de integração

[Unreleased]: https://github.com/USUARIO/OpenBanca/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/USUARIO/OpenBanca/releases/tag/v0.1.0
