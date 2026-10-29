# Gate E2E de perfil nativo DSH

O comando `bun run e2e:dsh:profile` prepara um perfil SDK real do DSH instalado, valida sua composição com `--dump-config` e instala somente o checkout local, o observador temporário e dependências disponíveis no cache offline. Por padrão, para antes do boot. O único modo de sondagem ativa usa duas chamadas `Agent.send` sintéticas, rejeita ambas em `agent/pre-step` e exige `DSHBANCA_DSH_PROFILE_LIFECYCLE_AUTHORIZED=yes`; sem autorização explícita não inicia lifecycle. A barreira falha antes de `step/start` e também bloqueia qualquer `agent/request` inesperado. Após a rejeição, o observador consulta os eventos persistidos em cada Session, exigindo ausência de `step/start`, `request/header`, `agent/request` e `assistant/message`, e confirma a remoção dos Agents descartados dos registries nativos.

## Contrato DSH verificado

A evidência foi conferida contra DSH `0.2.0-rc.2`, Cordis `4.0.4` e cordis-plugin-loader `1.0.5`. O runner registra também as versões instaladas dos pacotes `@deepseek-ai/dsh-agent`, `dsh-agent-loop`, `dsh-tools`, `dsh-agent-preset`, `dsh-agent-preset-registry` e `dsh-api-session-controller`.

- `ctx.agents.create({ sessionId, meta: { cwd } })` é a API nativa usada neste perfil. `AgentRegistry` delega a criação ao `AgentLoop`, que publica um `Agent` e sua `Session`. O teste confere `ctx.agents.get(agent.id) === agent`, `ctx.sessions.get(agent.id) === agent.session`, identidade de sessão igual à identidade do agente e `dispose()` do `AgentHandle` no teardown.
- O pacote `@deepseek-ai/dsh-api-session-controller` expõe o serviço `ctx.sessionController`. `SessionController.create({ cwd, agentPreset })` delega a criação/resolução ao `ApiSessionAgentController.ensureSession`. `SessionController.prompt()` é uma operação distinta e não é chamada pelo gate. O `hostApiSurvey` do perfil SDK real informa que `sessionController.create` e `sessionController.prompt` não estão montados neste perfil (`false`). Por isso o teste usa `ctx.agents.create`, que retorna o `AgentHandle` real e fornece o `dispose()` explícito, sem construir um controlador paralelo.
- A descoberta de presets é feita pelo serviço `ctx.agentPresets` de `@deepseek-ai/dsh-agent-preset-registry`, pertencente ao host DSH. O bundle DSHbanca registra somente `banca-auditor` por `@deepseek-ai/dsh-agent-preset`, que depende de `agentPresets`; não instala registry, altera `default`/`selectedDefault` ou define `standard`. No DSH Web, o host registra sua registry e seu preset `standard` em patches próprios. O perfil SDK mínimo não os contém, então o runner injeta registry e preset neutro apenas no overlay scratch; `banca-auditor` vem do bundle real.
- O despacho usa `ctx.tools.execute({ callId, name, arguments, agent, signal })` com o objeto `Agent` criado pelo DSH. No DSH inspecionado, `ToolRuntime` executa o waterfall `tools/pre-execute`, consulta os guards monotônicos e só então despacha o corpo. `ctx.tools.guard()` retorna o disposer Cordis da contribuição, que acompanha o lifecycle do contexto/plugin.

### Composição do preset e escopo

O bundle declara o loader nativo somente como filho de `banca-auditor`, com candidato basename `banca-auditor.md`, orçamento de 65536 bytes e sem candidatos locais. O preset `standard` continua sendo o fallback e a seleção persistida do usuário continua prevalecendo. O Agent de controle usa `standard` e precisa receber zero mensagens cuja proveniência inclua o candidato exclusivo do auditor. O frontmatter Markdown permanece conteúdo `user-message`; não concede permissões. Os guards de tools DSH da issue #2 continuam sendo a autoridade read-only.

O instalador mantém `.dsh/agents/banca-auditor.md` e cria uma cópia regular `banca-auditor.md` na raiz sintética, derivada byte a byte do asset canônico. Uma colisão, symlink ou cópia raiz divergente bloqueia sem sobrescrita silenciosa. A descoberta e associação efetivas só são aceitas quando a mensagem com `source.kind: agent-instructions`, `role: user`, digest do arquivo raiz e identidade Agent/Session são observados no hook nativo.

## Issue #3: proveniência e limite de carregamento do Markdown

O relatório separa o gate de identidade/guard da issue #2 do substatus de carregamento de instruções da issue #3. O `status` raiz continua descrevendo somente o gate de identidade, ferramentas e read-only da issue #2. `stages.auditorMarkdown.status` é o resultado específico da issue #3. Um `PASS` raiz não é aprovação do carregamento do Markdown.

No checkout validado, a fonte canônica é `assets/dsh/agents/banca-auditor.md` (SHA-256 `103cbdf191600d83a8becdb43ce89fc37aa0f5c532768238929524d0cbedaf7a`, SHA-1 `aedf761fe161b1befc61eaad15b6ec01cd11153c`). `installAssets` mantém `.dsh/agents/banca-auditor.md` e cria uma cópia regular na raiz. Uma cópia raiz preexistente só é aceita se seus bytes forem idênticos; cópia ausente é criada com exclusividade; conteúdo divergente, symlink ou tipo especial falha fechado. A suíte verifica instalação versionada/fallback, colisão, stale e symlink. Hashes iguais comprovam distribuição, não associação pelo host.

Contratos instalados inspecionados no DSH `0.2.0-rc.2`:

- `@deepseek-ai/dsh-agent-preset` recebe uma definição declarativa com `id` e `plugins` Cordis.
- `@deepseek-ai/dsh-agent-preset-registry` registra definições declaradas. `ctx.agentPresets.readDocument(id)` retorna a lista YAML de plugins da declaração, não importa um agente Markdown do diretório do projeto.
- `@deepseek-ai/dsh-agent-instructions` é um loader de instruções de workspace. Seus candidatos padrão são `AGENTS.md` e `CLAUDE.md`; nomes configurados precisam ser basenames, sem `/` ou `\\`, e a projeção de conteúdo no contexto da sessão ocorre no hook `agent/pre-step`.
- O hook público `agent/pre-step` permite observar a composição da proposta. A sonda preparada usa `Agent.send` apenas com mensagens sintéticas e retorna `kind: reject` depois de compor instruções; qualquer `step/start` ou `agent/request` é falha. A chamada ao modelo permanece impossível no caminho esperado e não usa credenciais.

O `--dump-config` confirma apenas a composição YAML. A execução real do hook `agent/pre-step` continua separada e exige autorização. O runner para antes do boot por padrão; `stages.auditorMarkdown.status` só pode ser `PASS` após a mensagem do auditor ser associada ao arquivo raiz, a mensagem do controle permanecer sem esse conteúdo e ambas as propostas serem rejeitadas antes de `step/start` e `agent/request`.

O contrato e os testes negativos rejeitam arquivo ausente/adulterado, cópia divergente, descoberta ausente, preset vazio, nome de preset sem digest de conteúdo carregado, projeção não observada, vínculo sintético ou IDs Agent/Session divergentes. Esses testes locais validam apenas o contrato de evidência. Não substituem a integração real nem afirmam que o DSH carregou as instruções. Nenhuma cópia adicional, loader próprio, permissão ou alteração do trust model foi introduzida para contornar o limite do host.

## Issue #38: descoberta e carregamento nativo das oito skills acadêmicas

O DSH gerencia extensões e skills acadêmicas através do serviço nativo `ctx.skills` pertencente ao pacote `@deepseek-ai/dsh-skill` (versão inspecionada `0.2.0-rc.2`). O provider nativo registrado em `src/dsh.ts` expõe as skills acadêmicas sob a identidade de provider `dshbanca` por meio de `ctx.skills.registerProvider`.

Para comprovar que o DSH real descobre e carrega integralmente o conjunto acadêmico do DSHbanca, a sonda verifica deterministicamente as oito skills:

1. `banca-avaliacao`
2. `banca-correcao`
3. `banca-detector-ia`
4. `banca-grille`
5. `banca-plagio`
6. `banca-planejador`
7. `banca-referencias`
8. `banca-revisor`

### Contrato de evidência para skills nativas

A verificação diferencia rigorosamente cada estágio:
- **Fonte empacotada (`packagedSkills`)**: verificação estática pré-boot no repositório de que `skills/<nome>/SKILL.md` existe e possui digest SHA-256 e tamanho compatíveis com o estado canônico.
- **Descoberta (`discovered`)**: consulta ao catálogo exposto pelo DSH via `ctx.skills.snapshot` com observação estrita de `complete === true`, confirmando que a skill está presente e que o provider vencedor é `dshbanca`. Caso `snapshot` falhe, lance erro ou retorne `complete !== true`, o fallback diagnóstico via `list` não atesta completude e `catalogComplete` permanece `false`. O catálogo global do host pode conter outras skills (não é artificialmente restrito a oito), mas as oito esperadas precisam provir de `dshbanca`.
- **Carregamento nativo (`loaded`)**: invocação da API nativa do DSH `ctx.skills.get(skillName, { cwd, signal })`. Não é feita chamada direta ao provider interno; o carregamento é mediado pelo registry do host.
- **Integridade verificada (`integrityVerified`)**: comparação do digest SHA-256 do corpo Markdown carregado (`content`, sem o frontmatter delimitado por `---`) contra o digest do corpo canônico. O conteúdo acadêmico integral nunca é exposto no relatório de evidência; apenas digests SHA-256 e contagem de bytes são registrados.
- **Bloqueio por host ausente ou não autorizado**: na ausência do DSH ou quando a execução ativa não foi autorizada (`DSHBANCA_DSH_PROFILE_LIFECYCLE_AUTHORIZED=yes`), o estágio permanece explicitamente `BLOCKED`.

O resultado é registrado de forma independente em `stages.nativeSkills`:
- `status`: `PASS`, `FAIL` ou `BLOCKED`.
- `evidence.skills`: mapa das oito skills contendo nome, provider, caminho relativo, status de descoberta, carregamento, digest SHA-256 do corpo e confirmação de integridade.
- `evidence.catalogComplete`: indicador rigoroso de completude do catálogo (`true` somente se `snapshot.complete === true` foi observado diretamente no host).

A aprovação em discovery não produz automaticamente `PASS` no carregamento. Ausência de API nativa (`BLOCKED`), catálogo incompleto ou não comprovado (`FAIL`), provider incorreto ou hash divergente resultam em `FAIL` ou `BLOCKED` imediatos. A invocação de `ctx.skills.get` comprova carregamento pelo serviço de skills do DSH, mas não equivale à execução ou aplicação das instruções por um agente ou modelo de IA.

## Cenário, integridade e teardown

O observador cria um workspace LaTeX/BibTeX sintético e um `Agent` real. Antes de selecionar o preset auditor, ele inicializa o projeto, cria um snapshot restaurável e executa uma correção válida como controle positivo. Assim, os argumentos de `banca_corrigir` correspondem a uma mutação real e `banca_restore` recebe um snapshot existente com `confirm: true`.

Depois da seleção nativa de `banca-auditor`, o teste:

1. despacha `banca_corrigir` e `banca_restore` pelo `ToolRuntime` real e exige erro com a razão explícita de política read-only, sem abort ou erro de argumentos;
2. registra tools-sombra no escopo real do Agent, com corpos que escreveriam no manuscrito e em marcadores. As chamadas de `banca_corrigir` e `banca_restore` são recusadas pelo guard nativo antes dos corpos, com zero invocações e sem marcadores;
3. compara o inventário SHA-256 completo, por caminho relativo, antes e depois das negações, incluindo `.banca/state.json`, o manuscrito e o snapshot;
4. confirma que `banca_status` continua permitido e que seu inventário antes/depois permanece igual;
5. cria outro `Agent` real pelo `AgentRegistry`, com `origin: "subagent"`, sessão pai e sem preset corretor. Uma tool-sombra de correção é recusada antes do corpo e os hashes continuam iguais;
6. verifica zero eventos `turn/start` e `request/header`, descarta os dois `AgentHandle`s com `dispose()` e, ao sair do processo DSH, remove o sandbox completo.

As tools-sombra são uma sonda adicional do guard nativo: seus corpos deliberadamente não contêm verificação de identidade. Elas não substituem os despachos das tools acadêmicas reais, que também são feitos com argumentos válidos e têm sua integridade verificada.

O relatório sanitizado registra SHA do repositório, versões, preset composto, tentativas e classificações, inventários relativos, atividade externa e teardown. Por padrão, o arquivo é `docs/evidence/dsh-profile-e2e.latest.json`. Para preservar um artefato preexistente, o chamador pode apontar `DSHBANCA_DSH_PROFILE_REPORT_PATH` para um caminho de scratch. O caminho externo não é gravado nem impresso no relatório.

## Pré-requisitos e isolamento

- DSH real no `PATH` ou `DSH_BIN` apontando para um executável existente.
- Node e Bun no `PATH`.
- Cópia do pnpm disponível no cache Corepack offline ou `PNPM_BIN` apontando para uma distribuição pnpm legítima (binário nativo como `pnpm-native` ou entrypoint JavaScript `.cjs`/`.mjs` com manifesto de pacote `pnpm` verificado e confinado).
- Dependências do checkout instaladas pelo fluxo normal.

Cada execução cria um diretório aleatório com permissões restritas e coloca `DSH_HOME`, `HOME`, `TMPDIR`, diretórios XDG, caches npm/Corepack, store pnpm e perfil DSH nesse sandbox. `DSH_TELEMETRY_MODE=DISABLED`, `pnpm --offline` e `COREPACK_ENABLE_NETWORK=0` evitam telemetria e downloads. O perfil usa stdin EOF, não envia solicitações JSON-RPC do SDK e nunca inicia modelo. O gate também compara o estado Git do checkout antes e depois da execução.

## Status e interpretação

- `PASS` / exit `0`: instalação offline, composição Cordis, descoberta das 16 tools e skills, identidade real `banca-auditor` pelo AgentRegistry/preset registry, negações antes dos corpos, integridade, status permitido, ausência de atividade de modelo e teardown passaram.
- `FAIL` / exit `1`: DSH estava disponível, mas uma etapa ou asserção do contrato falhou.
- `BLOCKED` / exit `2`: DSH, runtime ou dependência offline necessária não estava disponível. Ausência do host nunca conta como aprovação.

O CI comum não provisiona DSH. Sem `DSH_PROFILE_E2E_ENABLED=true`, ele registra a etapa como `BLOCKED`, não como validada. Com essa variável habilitada em runner provisionado, o E2E é obrigatório.

Os testes em `tests/e2e_dsh_profile_contract.test.ts` validam rejeições do contrato com fixtures locais. Eles não simulam nem substituem a execução do host real, e nunca contam como evidência E2E.

## Limitações

- Não cobre loop real de agente, `SessionController.prompt`, chamadas a modelo, identidade originada pelo gerenciador de subagents, avaliação acadêmica ou julgamento humano.
- O `Agent` com `origin: "subagent"` é criado pelo `AgentRegistry` nativo com metadados de origem e sessão pai, sem chamar o serviço que executa delegação. O teste comprova enforcement fail-closed para essa identidade DSH, não o lifecycle completo de spawn do subagent manager.
- `--dump-config` e os testes de contrato não comprovam associação no Agent real. A etapa ativa está bloqueada sem autorização específica e seu resultado não foi executado neste slice.
- O E2E mantém o status de identidade/guard da issue #2 separado de `stages.auditorMarkdown.status` (issue #3) e `stages.nativeSkills.status` (issue #38). Ambas as etapas continuam `BLOCKED` até existir evidência nativa autorizada no host DSH real, sem executar modelo.
- Os testes determinísticos locais em `tests/e2e_dsh_profile_contract.test.ts` comprovam que o contrato rejeita catálogos incompletos, skills ausentes, providers incorretos e divergências de conteúdo, mas não equivalem à execução no host DSH.
- Os hashes são de arquivos sintéticos e relativos ao workspace temporário. Nenhum manuscrito real é usado.

## Segurança da suíte de testes

`bun test` não inicia o E2E legado do OpenCode, mesmo que encontre um executável OpenCode. A execução dependente de modelo fica atrás de opt-in explícito e exige seleção de modelo e consentimento separado para credenciais do host. Para executá-la deliberadamente, defina `DSHBANCA_ENABLE_OPENCODE_MODEL_E2E=1`, `OPENCODE_E2E_MODEL=<modelo escolhido>` e `DSHBANCA_ALLOW_OPENCODE_E2E_HOST_AUTH=1`. Sem qualquer uma dessas condições, o teste é omitido ou o runner retorna `BLOCKED` antes de procurar credenciais ou iniciar subprocessos.

`buildProjectRunEnv()` também não lê `auth.json` nem propaga variáveis de autenticação por padrão. A cópia de credenciais ocorre somente quando o chamador passa explicitamente `seedAuth: true`. O gate `e2e:dsh:profile` não usa OpenCode, credenciais ou modelos.
