# Gate E2E de perfil nativo DSH

O comando `bun run e2e:dsh:profile` executa o perfil SDK real do DSH instalado. Ele não inicia um loop de modelo, não envia `session.prompt` ou `Agent.send`, não usa credenciais e não faz inferência. O teste instala somente o checkout local, o observador temporário e as dependências disponíveis no cache offline.

## Contrato DSH verificado

A evidência foi conferida contra DSH `0.2.0-rc.2`, Cordis `4.0.4` e cordis-plugin-loader `1.0.5`. O runner registra também as versões instaladas dos pacotes `@deepseek-ai/dsh-agent`, `dsh-agent-loop`, `dsh-tools`, `dsh-agent-preset`, `dsh-agent-preset-registry` e `dsh-api-session-controller`.

- `ctx.agents.create({ sessionId, meta: { cwd } })` é a API nativa usada neste perfil. `AgentRegistry` delega a criação ao `AgentLoop`, que publica um `Agent` e sua `Session`. O teste confere `ctx.agents.get(agent.id) === agent`, `ctx.sessions.get(agent.id) === agent.session`, identidade de sessão igual à identidade do agente e `dispose()` do `AgentHandle` no teardown.
- O pacote `@deepseek-ai/dsh-api-session-controller` expõe o serviço `ctx.sessionController`. `SessionController.create({ cwd, agentPreset })` delega a criação/resolução ao `ApiSessionAgentController.ensureSession`. `SessionController.prompt()` é uma operação distinta e não é chamada pelo gate. O `hostApiSurvey` do perfil SDK real informa que `sessionController.create` e `sessionController.prompt` não estão montados neste perfil (`false`). Por isso o teste usa `ctx.agents.create`, que retorna o `AgentHandle` real e fornece o `dispose()` explícito, sem construir um controlador paralelo.
- A descoberta de presets é feita pelo serviço `ctx.agentPresets` de `@deepseek-ai/dsh-agent-preset-registry`. O perfil temporário carrega a declaração pelo plugin Cordis `@deepseek-ai/dsh-agent-preset`, lista e resolve `banca-auditor`, cria um `Agent` real, chama `ctx.agentPresets.select(agent, "banca-auditor")` e verifica tanto `composedPreset(agent.ctx)` quanto a projeção persistida `agentPreset` da sessão.
- O despacho usa `ctx.tools.execute({ callId, name, arguments, agent, signal })` com o objeto `Agent` criado pelo DSH. No DSH inspecionado, `ToolRuntime` executa o waterfall `tools/pre-execute`, consulta os guards monotônicos e só então despacha o corpo. `ctx.tools.guard()` retorna o disposer Cordis da contribuição, que acompanha o lifecycle do contexto/plugin.

### Fixture de preset e limite de descoberta

O overlay do perfil E2E inclui um preset temporário `banca-auditor` com composição vazia. Essa declaração usa o registro e o carregamento nativos do DSH para testar identidade, seleção e enforcement sem modelo. Ela não adiciona permissões nem substitui o agente de produção.

Este gate **não comprova** que o DSH importe automaticamente `assets/dsh/agents/banca-auditor.md` ou `.dsh/agents/banca-auditor.md` para o registro nativo `AgentPreset`. A fixture de perfil não carrega o conteúdo dessas instruções. A identidade efetiva provada aqui é a identidade DSH validada pela registry e composta no `Agent.ctx`, não a execução do protocolo de auditoria por um modelo.

## Issue #3: proveniência e limite de carregamento do Markdown

O relatório separa o gate de identidade/guard da issue #2 do substatus de carregamento de instruções da issue #3. O `status` raiz continua descrevendo somente o gate de identidade, ferramentas e read-only da issue #2. `stages.auditorMarkdown.status` é o resultado específico da issue #3. Um `PASS` raiz não é aprovação do carregamento do Markdown.

No checkout validado, a fonte canônica é `assets/dsh/agents/banca-auditor.md` (SHA-256 `103cbdf191600d83a8becdb43ce89fc37aa0f5c532768238929524d0cbedaf7a`, SHA-1 `aedf761fe161b1befc61eaad15b6ec01cd11153c`). `package.json` inclui `assets`; a instalação executada por `banca_init`/`installAssets` copia esse arquivo para `.dsh/agents/banca-auditor.md`. O E2E registra os hashes do arquivo-fonte e da cópia efetivamente instalada. A suíte `audit_workflow_assets.test.ts` também compara as instalações versionada e fallback. A igualdade desses hashes comprova distribuição e instalação, não descoberta ou associação pelo host.

Contratos instalados inspecionados no DSH `0.2.0-rc.2`:

- `@deepseek-ai/dsh-agent-preset` recebe uma definição declarativa com `id` e `plugins` Cordis.
- `@deepseek-ai/dsh-agent-preset-registry` registra definições declaradas. `ctx.agentPresets.readDocument(id)` retorna a lista YAML de plugins da declaração, não importa um agente Markdown do diretório do projeto.
- `@deepseek-ai/dsh-agent-instructions` é um loader de instruções de workspace. Seus candidatos padrão são `AGENTS.md` e `CLAUDE.md`; nomes configurados precisam ser basenames, sem `/` ou `\\`, e a projeção de conteúdo no contexto da sessão ocorre no hook `agent/pre-step`.
- O `AgentLoop.preStep` é privado no contrato TypeScript instalado. O perfil cria um `Agent` real via `ctx.agents.create`, mas não chama `Agent.send`, `session.prompt` nem inicia o lifecycle de turn/step que executa a projeção.

O E2E real confirma que `banca_init` instala a fonte no workspace sintético e usa `readDocument` para inspecionar a composição nativa. A declaração de auditor usada para preservar o teste da issue #2 é uma fixture temporária com `plugins: []`. Não há mensagem de instruções com proveniência `.dsh/agents/banca-auditor.md` no inbox/eventos do agente, nem SHA-1 de conteúdo carregado pelo host. Por isso `stages.auditorMarkdown.status` fica `BLOCKED`, mesmo se o status raiz do gate da issue #2 for `PASS`.

O contrato e os testes negativos rejeitam arquivo ausente/adulterado, cópia divergente, descoberta ausente, preset vazio, nome de preset sem digest de conteúdo carregado, projeção não observada, vínculo sintético ou IDs Agent/Session divergentes. Esses testes locais validam apenas o contrato de evidência. Não substituem a integração real nem afirmam que o DSH carregou as instruções. Nenhuma cópia adicional, loader próprio, permissão ou alteração do trust model foi introduzida para contornar o limite do host.

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
- Cópia do pnpm disponível no cache Corepack offline ou `PNPM_BIN` apontando para um `pnpm.cjs` já instalado.
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
- A fixture vazia comprova a identidade e a política do preset no host. Não comprova descoberta, importação ou execução das instruções Markdown de `banca-auditor`.
- O E2E mantém o status de identidade/guard da issue #2 separado de `stages.auditorMarkdown.status`. A issue #3 continua `BLOCKED` até existir evidência nativa do conteúdo carregado e associado ao Agent/Session, sem executar modelo.
- Os hashes são de arquivos sintéticos e relativos ao workspace temporário. Nenhum manuscrito real é usado.

## Segurança da suíte de testes

`bun test` não inicia o E2E legado do OpenCode, mesmo que encontre um executável OpenCode. A execução dependente de modelo fica atrás de opt-in explícito e exige seleção de modelo e consentimento separado para credenciais do host. Para executá-la deliberadamente, defina `DSHBANCA_ENABLE_OPENCODE_MODEL_E2E=1`, `OPENCODE_E2E_MODEL=<modelo escolhido>` e `DSHBANCA_ALLOW_OPENCODE_E2E_HOST_AUTH=1`. Sem qualquer uma dessas condições, o teste é omitido ou o runner retorna `BLOCKED` antes de procurar credenciais ou iniciar subprocessos.

`buildProjectRunEnv()` também não lê `auth.json` nem propaga variáveis de autenticação por padrão. A cópia de credenciais ocorre somente quando o chamador passa explicitamente `seedAuth: true`. O gate `e2e:dsh:profile` não usa OpenCode, credenciais ou modelos.
