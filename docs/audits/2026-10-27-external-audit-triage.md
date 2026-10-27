# Triagem da auditoria externa — DSHbanca (27/10/2026)

> **Estado:** revisão estática documentada; **não** é teste de funcionamento do DSH. Esta página confronta uma auditoria externa baseada em cabeçalhos/fluxos Deflate de ZIP com arquivos **descomprimidos e legíveis obtidos no GitHub**. Não implementa nem autoriza mudanças funcionais.

## 1. Escopo, SHAs e limites

- **Auditoria recebida:** `RELATÓRIO DE AUDITORIA TÉCNICA, FUNCIONAL E ARQUITETURAL — DSHBANCA`, que descreve a árvore do commit [`26bc7c1cb3b6a88601b7148e0085b004ce5e0bc9`](https://github.com/Base-Analitica/DSHbanca/commit/26bc7c1cb3b6a88601b7148e0085b004ce5e0bc9). O próprio relatório declarou não poder descompactar o ZIP ou executar Bun/DSH.
- **Base revalidada na consulta de 27/10/2026:** `master` em `26bc7c1cb3b6a88601b7148e0085b004ce5e0bc9` (comparação `26bc7c1...master`: `identical`). Portanto, os falsos positivos abaixo **não** são explicados por um avanço da master desde o ZIP.
- **Integração proposta:** [PR #1](https://github.com/Base-Analitica/DSHbanca/pull/1), `fix/dsh-native-tools` em `c6e7bd5c54583868e351d0c80ce957d287e2a9a0` na consulta, **draft**, com mudanças solicitadas e sem merge. Seu conteúdo não existe automaticamente na `master`.
- **E2E real:** **BLOCKED / não comprovado** para o HEAD final. [Issue #3](https://github.com/Base-Analitica/DSHbanca/issues/3) registra um impedimento de autorização: o runner DSH da PR usa `Agent.send`, não coberto pela autorização anterior. Não executar nem contornar esse gate.
- **Ambiente desta triagem:** leitura via conector GitHub; computador remoto `pedro-550XED` offline, ambiente local de análise sem Bun e sem acesso DNS ao GitHub. Não houve `bun install`, `bun test`, compilação, E2E DSH/modelo, E2E OpenCode, MCP, LaTeX real nem avaliação humana. Resultados de execução nesta página são **BLOCKED**, não PASS.

### Ordem de evidência

Código/configuração lidos no SHA indicado > inventário de filenames > inferência pelo tamanho do arquivo/Deflate. Registro de tool e CI não substituem descoberta, invocação, segurança e lifecycle observados no **DSH/Cordis real**. A existência de um arquivo de teste não comprova sua execução ou suficiência.

## 2. Matriz dos seis GAPs

| ID | Veredito após verificação | Evidência e correção adequada |
| --- | --- | --- |
| **GAP-001** — OpenCode remanescente | **CONFIRMADO na master; tratado parcialmente pela PR #1, não incorporado.** | [`package.json`](../../package.json) inclui `@opencode-ai/plugin` e script `e2e:opencode`; [`src/index.ts`](../../src/index.ts) usa `Plugin` desse pacote; [`src/lib/install_assets.ts`](../../src/lib/install_assets.ts), `assets/opencode/`, `scripts/e2e-opencode.ts` e `tests/e2e-opencode.test.ts` são legado. Na PR #1 há `assets/dsh/`, alterações no entry e `scripts/e2e-dsh-profile.ts`. **Ação:** continuar #3/PR #1 após gates, e só remover legado quando houver equivalência operacional DSH, testes negativos e retirada segura. Não criar um segundo harness, fallback nem MCP genérico. |
| **GAP-002** — `src/dsh.ts` pequeno e sem `tests/dsh.test.ts` | **PARCIALMENTE CONFIRMADO na master; descrição técnica exagerada e já parcialmente endereçada na PR.** | [`src/dsh.ts`](../../src/dsh.ts) contém provider de skills e `inject = ["skills"]`, **não** registra as 16 tools nativamente na master. Na PR #1, `inject` inclui `tools`, há `ctx.tools.register`, guard e `tests/dsh.test.ts`; isso é **proposta/teste**, não prova de E2E no host. Tamanho do stream comprimido não mede correção. **Ação:** #3/PR #1, testes de contrato e E2E real no SHA final, respeitando o bloqueio de `Agent.send`. |
| **GAP-003** — `assets/opencode/commands/banca-init.md` vazio | **REFUTADO no próprio SHA analisado.** | [Arquivo na master](../../assets/opencode/commands/banca-init.md) contém frontmatter e instrução `Please execute the banca_init tool...` (147 caracteres na consulta textual). [Versão na PR #1](https://github.com/Base-Analitica/DSHbanca/blob/c6e7bd5c54583868e351d0c80ce957d287e2a9a0/assets/dsh/commands/banca-init.md) também não é vazia. **Não preencher por suposição**, nem considerar comando legado um comando DSH comprovado. |
| **GAP-004** — duplicação de oito skills | **CONFIRMADO na master (8/8).** | Comparação textual direta via GitHub: `skills/<nome>/SKILL.md` == `assets/opencode/skills/<nome>/SKILL.md` para `banca-avaliacao`, `banca-correcao`, `banca-detector-ia`, `banca-grille`, `banca-plagio`, `banca-planejador`, `banca-referencias` e `banca-revisor`. [`scripts/validate-skills.ts`](../../scripts/validate-skills.ts) ainda usa por padrão `assets/opencode/skills`; provider DSH da master lê `skills/`. **Ação:** escolher uma fonte canônica DSH e atualizar instalador/validadores/testes em folha independente **após** assegurar discovery, consumo e migração sem regressão; não apagar ativos agora. |
| **GAP-005** — 12 tools e 8 libs “sem testes” | **PARCIAL / MÉTRICA INSUFICIENTE.** | Ausência de arquivo `tests/<nome>.test.ts` dedicado não demonstra ausência de cobertura. [`tests/integration.test.ts`](../../tests/integration.test.ts) inclui testes de `state`, `banca_ia` e outros. A PR #1 adiciona suites para `safe_paths`, snapshot, restore e contrato DSH. **Ação:** construir matriz `comportamento crítico → teste → falha negativa → gate`, medir cobertura real, priorizando read-only, paths/symlinks, correção autorizada, snapshot/rollback e cobertura acadêmica. Não prometer 100% nem inferir vulnerabilidade só pelo nome de arquivo ausente. |
| **GAP-006** — `cordis.patch.yml` vazio/órfão | **REFUTADO; recomendação de exclusão é perigosa.** | [`cordis.patch.yml`](../../cordis.patch.yml) da master tem YAML não vazio que insere `dshbanca/dsh` (122 caracteres no texto lido). [`package.json`](../../package.json) referencia explicitamente esse patch em `dsh.bundle.patch` e exports. **Preservar** o arquivo; excluir poderia eliminar a declaração de composição nativa, apesar de carregamento real ainda não comprovado. |

## 3. Hipóteses do relatório

| Hipótese | Reclassificação | Evidência / ação |
| --- | --- | --- |
| **HIP-001** — entry DSH seria stub incompatível | **Insuficiência real na master; incompatibilidade de API NÃO COMPROVADA.** | O texto de `src/dsh.ts` da base permite afirmar provider de skills sem registro de tools, não uma falha observada no host. A PR #1 já implementa o registro candidato. Inspecionar versão e assinaturas do DSH/Cordis **instalados** e executar lifecycle somente sob autoridade válida (#3). |
| **HIP-002** — instalação hardcoded em `.opencode` | **CONFIRMADA no instalador legado; não extrapolar para entry Cordis.** | `src/lib/install_assets.ts` e `tests/command_assets.test.ts` exercitam instalação `.opencode`; a `master` exporta também `./dsh`, cujo provider lê `skills/`. Remover o código legado somente após demonstrar o caminho DSH correto e atualizar todos os consumidores. |
| **HIP-003** — simuladores/heurísticas mascaram provedores | **NÃO VERIFICADA.** | A presença de `banca_ia.ts`, `banca_plagio.ts`, `mcp_client.ts` e `provider_chain.ts` não prova conexão externa nem falso positivo. Testar falha de rede/timeout/recusa e proveniência quando houver capacidade/autorização; separar heurística de verificação objetiva. MCP/lifecycle geral pertencem ao DSH. |

## 4. Outras conclusões do relatório que exigem correção

- **Guias `docs/install.md` e `docs/installation.md` não são duplicação acidental:** a [issue #13](https://github.com/Base-Analitica/DSHbanca/issues/13) estabeleceu **guia curto** e **guia detalhado** com referências cruzadas. Não unificá-los por regra automática.
- A árvore `src/tools/` tem **16 módulos**, mas a contagem não prova 16 tools descobertas/executadas no DSH real. O `src/index.ts` atual está acoplado a OpenCode; `src/dsh.ts` da master só registra skills. Não anunciar MVP DSH operacional.
- O relatório usou ausência de bytes de Deflate visíveis e extensão de payload para sugerir arquivos vazios/stubs: esses métodos **não substituem leitura descomprimida**. GAP-003 e GAP-006 são contraexemplos verificáveis no mesmo commit.
- Há risco operacional na `master`: [`tests/e2e-opencode.test.ts`](../../tests/e2e-opencode.test.ts) pode descobrir binário do host e disparar caminho legado; [issue #17](https://github.com/Base-Analitica/DSHbanca/issues/17) documenta esse preflight. A PR #1 introduz opt-in e regressões, **ainda não incorporadas**. **Não rodar `bun test` indiscriminadamente em ambiente com credenciais ou OpenCode** sem análise prévia. CI verde não equivale à prova de segurança/DSH real.

## 5. Encaminhamento: sem duplicação de trabalho

1. **Integração e enforcement DSH (P1/bloqueada):** [PR #1](https://github.com/Base-Analitica/DSHbanca/pull/1) e [issue #3](https://github.com/Base-Analitica/DSHbanca/issues/3). Revalidar branch/HEAD, autorização específica de `Agent.send` e gates do host antes de qualquer execução. Sem essa evidência, sem aprovação/merge da PR.
2. **Interação de decisões acadêmicas:** [issue #4](https://github.com/Base-Analitica/DSHbanca/issues/4), dependente da #3; selecionar opção não autoriza mutação de manuscrito.
3. **Redução de duplicação/legado (dívida, não corte imediato):** planejar folha própria **após prova de equivalência DSH**; incluir canonicalização de skills, caminhos `assets/dsh`, validador, testes e remoção segura de `@opencode-ai/plugin`/runner antigo. Exigir prova negativa de que nenhum caminho suportado ainda depende do legado.
4. **Cobertura acadêmica, segurança e rollback:** criar apenas folhas específicas por falha reproduzida/contrato não exercitado; não gerar vinte issues automaticamente porque faltam filenames de teste.
5. **Instalação/documentação:** [#13](https://github.com/Base-Analitica/DSHbanca/issues/13) já resolveu a distinção dos dois guias; não reabrir sem defeito novo.

## 6. Gates para esta página e para trabalho posterior

| Gate | Estado nesta triagem | Motivo |
| --- | --- | --- |
| Inspeção textual de arquivos `master`/PR e comparação de 8 skills | **PASS** | Conteúdos consultados pelo GitHub no SHA indicado; não implica execução. |
| Verificação de branch, issue, escopo e PR draft | **PASS** para o registro documental; revalidar antes de merge | Sem mutação da master nem da PR #1. |
| `bun install --frozen-lockfile`, `bun run typecheck`, `bun run build`, `bun run validate:skills`, `bun run validate:agents` | **BLOCKED** | Sem Bun/checkout executável no ambiente desta revisão. |
| `bun test` e `git diff --check` local | **BLOCKED** | Sem Bun/checkout local; suíte legado exige preflight, e integridade do diff local deve ser checada em executor isolado. |
| DSH/Cordis real no SHA final, execução de 16 tools, guard, Agent/Session, erros e teardown | **BLOCKED** | #3: autoridade específica insuficiente para runner que usa `Agent.send`; host/versão não observados nesta triagem. |
| LaTeX/BibTeX reais, qualidade acadêmica e revisão humana | **NÃO VERIFICADOS** | Fora de escopo e sem corpus/ambiente. |

**Conclusão:** o relatório externo identificou corretamente o legado e a duplicação estrutural, mas as afirmações de arquivos vazios e remoção do patch Cordis estavam erradas; parte do déficit de testes e da integração já está tratada na PR #1, ainda sem prova E2E DSH autorizada. Não é legítimo declarar o DSHbanca funcional no host, tampouco aplicar remoções destrutivas a partir desse relatório.
