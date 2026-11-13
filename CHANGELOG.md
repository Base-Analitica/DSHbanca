# Changelog

Todas as mudanças relevantes serão documentadas aqui.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/),
e este projeto adere ao [Semantic Versioning](https://semver.org/lang/pt-BR/).

## [Unreleased]

### Corrigido

- `banca_corrigir`: falha de escrita após truncamento/escrita parcial agora é classificada pela releitura real do destino (identidade dev/ino + bytes), com distinção entre destinos aplicados, destino possivelmente alterado (sha256 antes/depois, tamanho observado) e destinos não processados; estado é declarado indeterminado quando não verificável, o snapshot real permanece para recuperação e a iteração é registrada como `failed`. O retorno nunca afirma manuscrito intacto sem verificação byte a byte.
- `banca_corrigir`: `oldText`, `newText` e o conteúdo planejado precisam ser Unicode bem-formado e representável exatamente em UTF-8; surrogates UTF-16 isolados (incluindo busca que dividiria um par substituto) são rejeitados antes do snapshot e o round-trip do resultado é verificado, sem normalização nem substituição silenciosa por U+FFFD.
- Runner E2E nativo DSH (`scripts/e2e-dsh-profile.ts`): sonda positiva de restauração do snapshot parcial automático criado pela própria correção, despachada pelo `ToolRuntime` nativo com vínculo por hash de ponta a ponta (original → manifesto → vault → `banca_restore` → hash restaurado) e preservação de arquivo não selecionado; a correção válida é reaplicada para manter a prova negativa do auditor.
- Contrato de evidência do E2E nativo (`scripts/lib/dsh-profile-e2e-contract.ts`): validação fail-closed das sondas #110 — contadores de iterações/snapshots precisam existir, ser inteiros seguros não negativos e iguais antes/depois; inventários precisam conter hashes SHA-256 de `main.tex`, `.banca/state.json`, `extra.tex` (lote inválido) e artefatos do vault, comparados integralmente; restauração positiva sem vínculo com o snapshot automático/hash original é rejeitada.
- Contrato de evidência do E2E nativo: inventories das sondas negativas vinculadas à captura automática exata (`correctionRestore.snapshot.label`) — manifesto e `main.tex` capturado do mesmo label, hash do arquivo igual ao original/vault, manifesto preservado antes/depois e `main.tex` do workspace igual ao hash corrigido declarado; artefatos de snapshots anteriores não substituem a captura. A exatidão da correção positiva passa a comparar o texto inteiro com o resultado esperado da substituição única (`expectedCorrectedSha256`), não apenas sentinelas.
- `banca_corrigir`: preflight integral fail-closed do lote antes de snapshot, estado ou escrita — uma correção inválida (inclusive no segundo arquivo) bloqueia todas as demais, sem aplicação parcial, sem iteração de sucesso e sem snapshot.
- `banca_corrigir`: `expectedOccurrences` agora é inteiro positivo seguro e precisa coincidir com a contagem real de ocorrências literais não sobrepostas; quando omitido, apenas uma ocorrência é admitida. Divergência ou ambiguidade bloqueia o lote (antes emitia aviso e aplicava `replaceAll`).
- `banca_corrigir`: `newText` é inserido literalmente, sem interpretar templates de substituição JavaScript (`$&`, `$$`, `$'`, `` $` ``), regex, comandos LaTeX ou normalização textual; conteúdo não UTF-8 é recusado para não corromper bytes não selecionados.
- `banca_corrigir`: snapshot parcial real é criado apenas após o lote válido, revalidado contra os bytes do preflight e registrado antes da aplicação; falhas de I/O posteriores são comunicadas com recuperação honesta pelo snapshot, sem rollback fictício.
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
