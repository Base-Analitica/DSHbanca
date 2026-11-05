# Creator Mode: desenvolvimento e validação do DSHbanca

O **DSH é o único harness** do DSHbanca; Cordis compõe o plugin no host. Esta página separa duas trilhas no mesmo DSH, sem outro harness:

## Trilha 1 — Creator Mode: desenvolvimento

O Creator é o ambiente padrão para manter o plugin: ler o repositório, editar somente o escopo autorizado, executar testes herméticos, build e validadores, criar commits e atualizar a PR existente. O Creator é um preset/ferramenta de desenvolvimento, não um papel acadêmico nem uma fronteira de segurança própria. Ele **não herda automaticamente** o guard acadêmico de `banca-auditor`; texto, nome visível ou presença do bundle não comprovam associação nem enforcement. Ver [issue #57](https://github.com/Base-Analitica/DSHbanca/issues/57).

## Trilha 2 — DSHbanca: validação do produto

A validação acadêmica nativa usa o preset `banca-auditor` registrado em [`cordis.patch.yml`](../../cordis.patch.yml), por meio de um perfil DSH apropriado e isolado. O gate nativo existente é [`bun run e2e:dsh:profile`](../dsh-profile-e2e.md): ele não é executado por esta atualização documental e não deve ser declarado como passado sem execução autorizada no SHA correspondente.

Separe quatro resultados que não se substituem:

- **E2E DSH nativo sem modelo:** boot/composição, discovery, associação, dispatch, guardas e ferramentas com entradas sintéticas, quando observados pelo gate real.
- **Teste com modelo:** comportamento dependente de modelo; opt-in e autorização humana, credenciais/custo e provedor explicitamente definidos. Não faz parte do E2E hermético sem modelo.
- **UX Web interativa:** seleção/renderização real no DSH Web, sessão aberta/reconectada e associação visível; não é provada por fixture nem por boot de servidor.
- **Avaliação acadêmica humana:** juízo sobre qualidade, rubrica, nota ou instituição; não é provado por ferramenta, síntese determinística ou modelo.

## Versões e proveniência do contrato

Em 05/11/2026, o CLI instalado neste ambiente reportou `@deepseek-ai/dsh@0.2.1-rc.5`; os manifests instalados informam Cordis `4.0.5` e `cordis-plugin-loader@1.0.6`. O Host Inspect confirmou os contratos públicos `permissionPresets.current(session)`, `sandboxPolicy.resolve(request?)` / `overrideOf(session)`, `approval.overrideOf(session)` e `sandbox.confine(argv, policy, signal?)`. Isso confirma **assinaturas disponíveis**, não os valores efetivos de uma sessão Creator, a composição do perfil, o runner ativo ou enforcement observado.

O histórico de 03/11 registrou instalação/composição/boot de Creator em `creator-dev` e E2E DSH sem modelo em SHAs próprios. Isso é histórico, não evidência nova deste checkout ou de um novo HEAD. O bundle atual do DSHbanca registra `banca-auditor`; não declare `banca-corretor` integralmente implementado/registrado porque o código atual apenas contém verificações de identidade com esse prefixo. Consulte também [`src/dsh.ts`](../../src/dsh.ts) e [`docs/dsh-profile-e2e.md`](../dsh-profile-e2e.md).

## Bootstrap inicial confiável (uma vez, somente se indispensável)

O bootstrap abaixo serve somente quando ainda não há um Creator de desenvolvimento devidamente preparado. Faça-o com autorização humana e em perfil/worktree scratch separados; **não reinstale o host nem recrie o perfil para cada PR**. Uma instalação/perfil já configurados seguem a rotina cotidiana dentro do Creator mais adiante. Não copie configuração, sessão, plugin ou credencial de perfil produtivo; não trate `file:` como symlink vivo.

Se um bootstrap for realmente indispensável, use terminal confiável do operador, fora da sessão Creator. O guard abaixo não autoriza por si só instalação, criação de perfil, `plugin add` ou boot Web. Não use credenciais, não aprove scripts em lote e não prossiga se a política efetiva ou o isolamento não puderem ser comprovados.

**Limite de isolamento:** `DSH_HOME` novo, sozinho, não impede fallbacks `.env` do projeto/usuário nem herança de ambiente. O preflight verifica apenas nomes `.env*` (inclusive ignorados por Git, sem ler valores), reserva destinos novos com modo 0700 e, depois dos guards, executa cada subprocesso com ambiente `env -i` e variáveis explicitamente permitidas. Antes de cada subprocesso (inclusive `plugin add`), `check_scratch` revalida identidade/inode do linked worktree e dirs Git, branch/HEAD/base/merge-base, estado limpo e ausência de `.env*`. `PATH` vem do terminal confiável, deve ser conferido antes do uso e não carrega as demais variáveis do operador. `HOME`/XDG e cwd ficam isolados, exceto Bun, que usa o cwd do checkout para validar/buildar. TOCTOU de outro processo sob o mesmo usuário entre verificações e uso não é eliminado. Nenhuma credencial real deve ser importada.

Antes do script, obtenha **para a PR em execução** `EXPECTED_BRANCH` e `EXPECTED_BASE_BRANCH` pela metadata da PR; `EXPECTED_HEAD_SHA` pelo head SHA da PR; `EXPECTED_BASE_SHA` pela ref atual do branch base no GitHub; e `EXPECTED_MERGE_BASE_SHA` pelo `merge_base_commit.sha` da comparação entre essas refs exatas. Não use valores históricos deste issue nem derive a expectativa apenas do mesmo checkout que será validado. Atualize a ref local `origin/<base>` para esse SHA em etapa separada e confirme `origin` como o repositório esperado. O script não buscará nem adivinhará refs: qualquer divergência bloqueia antes de reservar destinos.

Defina `WORKTREE` como raiz canônica de um **linked worktree** da branch da PR em execução, limpo e sem alterações alheias; `DSH_DEV_PREFIX` e `DSH_HOME` devem ser destinos novos, exclusivos e fora do checkout/perfil produtivo.

```bash
# Executar manualmente no terminal confiável do operador, fora do Creator Agent.
set -euo pipefail
export WORKTREE=/caminho/canonico/para/DSHbanca-worktree
# Forneça EXPECTED_BRANCH, EXPECTED_BASE_BRANCH, EXPECTED_HEAD_SHA,
# EXPECTED_BASE_SHA e EXPECTED_MERGE_BASE_SHA conforme a PR verificada acima.
export DSH_DEV_PREFIX="$HOME/.local/opt/dsh-creator-0.2.1-rc.5"
export DSH_HOME="$HOME/.local/state/dshbanca-creator"
export DSH_CREATOR_CLI="$DSH_DEV_PREFIX/node_modules/@deepseek-ai/dsh/lib/bin.js"

# Preflight SOMENTE LEITURA até validar todas as pré-condições; depois reserva destinos scratch.
blocked() { printf 'BLOCKED: %s; downstream operations stopped (inspect new scratch reservations, if any).\n' "$1" >&2; exit 1; }
: "${EXPECTED_BRANCH:?supply PR head branch verified from GitHub}"
: "${EXPECTED_BASE_BRANCH:?supply PR base branch verified from GitHub}"
: "${EXPECTED_HEAD_SHA:?supply exact PR head SHA verified from GitHub}"
: "${EXPECTED_BASE_SHA:?supply current base ref SHA verified from GitHub}"
: "${EXPECTED_MERGE_BASE_SHA:?supply expected merge-base SHA from GitHub compare}"
BASE_REF="refs/remotes/origin/$EXPECTED_BASE_BRANCH"
for path in "$WORKTREE" "$DSH_DEV_PREFIX" "$DSH_HOME"; do
  [ "$path" = "$(realpath -m -- "$path")" ] || blocked "path must be absolute/canonical and contain no symlink ancestors"
done
[ -d "$WORKTREE" ] && [ ! -L "$WORKTREE" ] ||
  blocked "WORKTREE must be an existing canonical directory"
# O gitfile não basta (submódulos também usam .git como arquivo).
[ -f "$WORKTREE/.git" ] && [ ! -L "$WORKTREE/.git" ] ||
  blocked "WORKTREE must have a Git linked-worktree gitfile"
export GIT_OPTIONAL_LOCKS=0  # Evita atualização incidental do índice no preflight.
GIT_DIR="$(git -C "$WORKTREE" rev-parse --absolute-git-dir 2>/dev/null)" ||
  blocked "cannot resolve linked worktree Git directory"
GIT_COMMON_DIR="$(git -C "$WORKTREE" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" ||
  blocked "cannot resolve shared Git common directory"
[ "$GIT_DIR" != "$GIT_COMMON_DIR" ] ||
  blocked "WORKTREE is a main checkout/submodule rather than linked worktree"
git -C "$WORKTREE" worktree list --porcelain 2>/dev/null |
  grep -Fx -- "worktree $WORKTREE" >/dev/null ||
  blocked "WORKTREE is not registered as a linked worktree"
[ "$(git -C "$WORKTREE" rev-parse --show-toplevel 2>/dev/null)" = "$WORKTREE" ] ||
  blocked "WORKTREE is not the Git repository root"
[ "$(git -C "$WORKTREE" remote get-url origin 2>/dev/null)" = "https://github.com/Base-Analitica/DSHbanca.git" ] ||
  blocked "unexpected repository origin; verify the scratch checkout"
git check-ref-format --branch "$EXPECTED_BRANCH" >/dev/null 2>&1 &&
  [ "$EXPECTED_BRANCH" != "$EXPECTED_BASE_BRANCH" ] &&
  [ "$(git -C "$WORKTREE" symbolic-ref --quiet --short HEAD 2>/dev/null)" = "$EXPECTED_BRANCH" ] ||
  blocked "wrong PR branch or detached checkout"
git check-ref-format --branch "$EXPECTED_BASE_BRANCH" >/dev/null 2>&1 ||
  blocked "invalid PR base branch"
[[ "$EXPECTED_HEAD_SHA" =~ ^[0-9a-f]{40}$ ]] ||
  blocked "EXPECTED_HEAD_SHA must be the independently verified full PR head SHA"
[[ "$EXPECTED_BASE_SHA" =~ ^[0-9a-f]{40}$ ]] ||
  blocked "EXPECTED_BASE_SHA must be the independently verified full base-tip SHA"
[[ "$EXPECTED_MERGE_BASE_SHA" =~ ^[0-9a-f]{40}$ ]] ||
  blocked "EXPECTED_MERGE_BASE_SHA must be the independently verified full merge-base SHA"
[ "$(git -C "$WORKTREE" rev-parse --verify 'HEAD^{commit}' 2>/dev/null)" = "$EXPECTED_HEAD_SHA" ] ||
  blocked "checkout HEAD does not match the verified PR head SHA"
[ "$(git -C "$WORKTREE" rev-parse --verify "$BASE_REF^{commit}" 2>/dev/null)" = "$EXPECTED_BASE_SHA" ] ||
  blocked "current origin base ref does not match the independently verified GitHub base SHA"
[ "$(git -C "$WORKTREE" merge-base "$BASE_REF" HEAD 2>/dev/null)" = "$EXPECTED_MERGE_BASE_SHA" ] ||
  blocked "local merge-base does not match the independently verified GitHub compare result"
git_status="$(git -C "$WORKTREE" status --porcelain=v1 --untracked-files=all 2>/dev/null)" ||
  blocked "cannot inspect WORKTREE status"
[ -z "$git_status" ] ||
  blocked "WORKTREE contains staged, unstaged or untracked changes"
# Arquivos .env* são ignorados pelo Git: detecte NOMES, sem ler conteúdo ou seguir links.
env_candidate="$(find "$WORKTREE" -name '.env*' -print -quit 2>/dev/null)" ||
  blocked "cannot inspect worktree for ignored .env files"
[ -z "$env_candidate" ] ||
  blocked "worktree contains .env* (including ignored files); do not load any credentials"
case "$DSH_HOME/" in "$WORKTREE/"*|"$DSH_DEV_PREFIX/"*) blocked "DSH_HOME must be outside worktree and installation prefix" ;; esac
case "$DSH_DEV_PREFIX/" in "$WORKTREE/"*|"$DSH_HOME/"*) blocked "installation prefix must be outside worktree and DSH_HOME" ;; esac
for destination in "$DSH_DEV_PREFIX" "$DSH_HOME"; do
  [ ! -e "$destination" ] && [ ! -L "$destination" ] ||
    blocked "scratch destination already exists; do not reuse existing state"
  [ -d "$(dirname "$destination")" ] ||
    blocked "destination parent does not exist; prepare it separately in a trusted terminal"
done
# Confira executáveis requeridos antes de criar qualquer destino scratch.
NODE_BIN="$(command -v node)" || blocked "Node unavailable before scratch reservation"
NPM_BIN="$(command -v npm)" || blocked "npm unavailable before scratch reservation"
BUN_BIN="$(command -v bun)" || blocked "Bun unavailable before scratch reservation"
command -v stat >/dev/null 2>&1 || blocked "stat unavailable before scratch reservation"
command -v mkdir >/dev/null 2>&1 || blocked "mkdir unavailable before scratch reservation"
command -v env >/dev/null 2>&1 || blocked "env unavailable before scratch reservation"
# Snapshot de identidade do checkout e do Git antes de qualquer reserva.
WORKTREE_ID="$(stat -Lc '%d:%i:%u' -- "$WORKTREE")" || blocked "cannot record worktree identity"
GIT_DIR_ID="$(stat -Lc '%d:%i:%u' -- "$GIT_DIR")" || blocked "cannot record linked worktree Git identity"
GIT_COMMON_DIR_ID="$(stat -Lc '%d:%i:%u' -- "$GIT_COMMON_DIR")" || blocked "cannot record shared Git identity"
# Reserva exclusiva/atômica: sem -p, sem reuso, proprietário somente (0700).
# Falha parcial deixa diretório NOVO vazio para inspeção manual; nunca remova estado alheio.
umask 077
mkdir -m 700 -- "$DSH_DEV_PREFIX" ||
  blocked "exclusive prefix reservation failed; inspect any new empty scratch directory"
mkdir -m 700 -- "$DSH_HOME" ||
  blocked "exclusive DSH_HOME reservation failed; inspect prefix reservation before cleanup"
DSH_BOOT_HOME="$DSH_HOME/operator-home"
mkdir -m 700 -- "$DSH_BOOT_HOME" ||
  blocked "cannot create isolated operator home; inspect reserved scratch paths"
PREFIX_ID="$(stat -Lc '%d:%i:%u' -- "$DSH_DEV_PREFIX")"
HOME_ID="$(stat -Lc '%d:%i:%u' -- "$DSH_HOME")"
BOOT_ID="$(stat -Lc '%d:%i:%u' -- "$DSH_BOOT_HOME")"

check_scratch() {
  [ "$DSH_DEV_PREFIX" = "$(realpath -m -- "$DSH_DEV_PREFIX")" ] &&
    [ "$DSH_HOME" = "$(realpath -m -- "$DSH_HOME")" ] &&
    [ ! -L "$DSH_DEV_PREFIX" ] && [ ! -L "$DSH_HOME" ] &&
    [ ! -L "$DSH_BOOT_HOME" ] &&
    [ "$(stat -Lc '%d:%i:%u' -- "$DSH_DEV_PREFIX")" = "$PREFIX_ID" ] &&
    [ "$(stat -Lc '%d:%i:%u' -- "$DSH_HOME")" = "$HOME_ID" ] &&
    [ "$(stat -Lc '%d:%i:%u' -- "$DSH_BOOT_HOME")" = "$BOOT_ID" ] ||
    blocked "reserved scratch path changed; stop before writing"
  [ "$WORKTREE" = "$(realpath -m -- "$WORKTREE")" ] && [ ! -L "$WORKTREE" ] &&
    [ "$(stat -Lc '%d:%i:%u' -- "$WORKTREE")" = "$WORKTREE_ID" ] &&
    [ -f "$WORKTREE/.git" ] && [ ! -L "$WORKTREE/.git" ] &&
    [ "$(git -C "$WORKTREE" rev-parse --show-toplevel 2>/dev/null)" = "$WORKTREE" ] &&
    [ "$(git -C "$WORKTREE" rev-parse --absolute-git-dir 2>/dev/null)" = "$GIT_DIR" ] &&
    [ "$(git -C "$WORKTREE" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" = "$GIT_COMMON_DIR" ] &&
    [ "$(stat -Lc '%d:%i:%u' -- "$GIT_DIR")" = "$GIT_DIR_ID" ] &&
    [ "$(stat -Lc '%d:%i:%u' -- "$GIT_COMMON_DIR")" = "$GIT_COMMON_DIR_ID" ] &&
    git -C "$WORKTREE" worktree list --porcelain 2>/dev/null | grep -Fx -- "worktree $WORKTREE" >/dev/null ||
    blocked "linked worktree identity changed; stop before writing"
  [ "$(git -C "$WORKTREE" remote get-url origin 2>/dev/null)" = "https://github.com/Base-Analitica/DSHbanca.git" ] &&
    [ "$(git -C "$WORKTREE" symbolic-ref --quiet --short HEAD 2>/dev/null)" = "$EXPECTED_BRANCH" ] &&
    [ "$(git -C "$WORKTREE" rev-parse --verify 'HEAD^{commit}' 2>/dev/null)" = "$EXPECTED_HEAD_SHA" ] &&
    [ "$(git -C "$WORKTREE" rev-parse --verify "$BASE_REF^{commit}" 2>/dev/null)" = "$EXPECTED_BASE_SHA" ] &&
    [ "$(git -C "$WORKTREE" merge-base "$BASE_REF" HEAD 2>/dev/null)" = "$EXPECTED_MERGE_BASE_SHA" ] ||
    blocked "PR branch, head, base or merge-base changed; stop before writing"
  git_status="$(git -C "$WORKTREE" status --porcelain=v1 --untracked-files=all 2>/dev/null)" ||
    blocked "cannot recheck worktree status"
  [ -z "$git_status" ] || blocked "worktree became dirty; stop before writing"
  env_candidate="$(find "$WORKTREE" -name '.env*' -print -quit 2>/dev/null)" ||
    blocked "cannot recheck ignored environment files"
  [ -z "$env_candidate" ] ||
    blocked "new .env* appeared; stop before running isolated commands"
}
# Não herde variáveis de autenticação, NODE_OPTIONS, XDG, HOME nem .env do operador.
# CLI/Plugin Manager/Web usam cwd HOME isolado; Bun exige cwd no checkout,
# mas deve usar o MESMO ambiente limpo. PATH é do terminal confiável do operador.
safe_exec_in() {
  local target_dir="$1"
  shift
  check_scratch
  (
    cd "$target_dir" || blocked "cannot enter isolated command working directory"
    env -i HOME="$DSH_BOOT_HOME" DSH_HOME="$DSH_HOME" PATH="$PATH" \
      XDG_CONFIG_HOME="$DSH_HOME/xdg-config" \
      XDG_STATE_HOME="$DSH_HOME/xdg-state" \
      XDG_CACHE_HOME="$DSH_HOME/xdg-cache" \
      XDG_DATA_HOME="$DSH_HOME/xdg-data" \
      "$@"
  )
}
safe_exec() { safe_exec_in "$DSH_BOOT_HOME" "$@"; }
safe_repo_exec() { safe_exec_in "$WORKTREE" "$@"; }
safe_dsh() { safe_exec "$NODE_BIN" "$DSH_CREATOR_CLI" "$@"; }

# FIM DO PREFLIGHT; início das instalações.
safe_exec "$NPM_BIN" install --prefix "$DSH_DEV_PREFIX" --no-audit --no-fund --ignore-scripts --save-exact @deepseek-ai/dsh@0.2.1-rc.5
safe_dsh --version
safe_repo_exec "$BUN_BIN" install --frozen-lockfile
safe_repo_exec "$BUN_BIN" run typecheck
safe_repo_exec "$BUN_BIN" run build
safe_repo_exec "$BUN_BIN" test tests/creator_mode_bootstrap.test.ts
safe_repo_exec "$BUN_BIN" run validate:skills
safe_repo_exec "$BUN_BIN" run validate:agents
git -C "$WORKTREE" diff --check

# --from-default-profile pode sobrescrever perfil: falhe se criado por outro processo.
check_scratch
[ ! -e "$DSH_HOME/profiles/creator-dev" ] &&
  [ ! -L "$DSH_HOME/profiles/creator-dev" ] ||
  blocked "creator-dev appeared before profile bootstrap; do not overwrite"
safe_dsh --profile creator-dev --from-default-profile web --dump-config >/dev/null

safe_dsh plugin --profile creator-dev add --ignore-scripts "file:$WORKTREE"
safe_dsh --profile creator-dev --dump-config >/dev/null
safe_dsh --profile creator-dev --host 127.0.0.1 --port 38087 --no-open
```

O teste sintético `bun test tests/creator_mode_bootstrap.test.ts` valida somente as guardas descritas e nunca executa instalação, Plugin Manager, perfil Web, `Agent.send` ou modelo. O bootstrap real permanece um gate separado, pontual e sujeito a autorização humana; não o repita para cada PR.

Se o operador inicializar o Web durante esse bootstrap, mantenha a URL local e não compartilhe token em PR, relatório, captura ou log público. Esse boot histórico não prova associação do Creator a Agent/Session, UX interativa ou enforcement.

Depois de um perfil de desenvolvimento já configurado, selecione no Web o worktree correto e Creator apenas como contexto de desenvolvimento. A presença ou seleção visual de Creator não prova a política efetiva da sessão; siga o preflight abaixo antes de qualquer ação mutante. Nunca encaminhe manuscrito real para essa sessão.

## Preflight obrigatório da sessão Creator

A política efetiva e os limites vêm do DSH real, não do nome visual do preset. Antes de editar ou executar qualquer validação que escreva, confirme a mesma sessão/Agent, o workspace canônico, a branch/PR em andamento e a política observável no runtime context. Não use `--dump-config`, um YAML, manifesto, nome de preset ou teste fixture como prova de enforcement.

No DSH `0.2.1-rc.5` / Cordis `4.0.5`, os contratos públicos verificados por Host Inspect são:

- `permissionPresets.current(session): string` informa o preset que corresponde aos valores efetivos; o rótulo não comprova enforcement nem associação do Agent.
- `sandboxPolicy.resolve(request?)` retorna política por chamada (`mode`, `workspaceRoot`, `sessionId`); a sessão com `cwd` delimita `workspace-write`, e a raiz configurada é fallback para chamadas sem cwd. `sandboxPolicy.overrideOf(session)` pode retornar `undefined`, caso em que vale a configuração padrão.
- `approval.overrideOf(session)` retorna somente o override (`ask` ou `never`); `undefined` exige conferir a configuração efetiva. A presença de `ask` não prova que exista answerer/UI disponível.
- `sandbox.confine(argv, policy, signal?)` é o seam de subprocesso e retorna `ConfinedArgv`, incluindo `enforcement: full|partial`; isso não prova a configuração ativa de um backend nem o enforcement de filesystem.
- `tools.guard(guard)` é monotônico no dispatch nativo. Só protege as chamadas que alcançam o plugin/guard associado ao Agent; o Creator não recebe automaticamente o guard acadêmico de `banca-auditor`.

As assinaturas foram observadas no DSH instalado; Host Inspect é read-only e não invoca esses serviços nem revela os valores de uma sessão Creator. Não foram confirmados neste slice o preset selecionado, os valores por sessão, o answerer, o provider ativo, a associação Web Agent/Session ou enforcement em dispatch Creator. Não infira `ctx.fs.sandboxMode`/`ctx.shell.sandboxMode`: essas propriedades não constam dos contratos consultados. Manifests instalados identificam `@deepseek-ai/dsh-sandbox`, `@deepseek-ai/dsh-sandbox-policy`, `@deepseek-ai/dsh-fs-sandbox`, `@deepseek-ai/dsh-tool-fs` e `@deepseek-ai/dsh-tool-bash` em `0.2.1-rc.5`; a disponibilidade do pacote/provider não prova que o perfil o montou.

Se a sessão indicar `danger-full-access`, `never`, raiz errada, identidade ausente, runner/answerer não observado ou enforcement não verificável, não execute operação sensível, não instale plugin, não altere perfil e não tente ampliar permissões: registre o subgate como `BLOCKED`. Continue somente inspeções e verificações documentais seguras. A comprovação do Creator real é acompanhada pela [issue #62](https://github.com/Base-Analitica/DSHbanca/issues/62); não execute `Agent.send` apenas para satisfazer um gate.

## Rotina cotidiana no Creator já configurado

1. Abra o worktree correto e confirme o `workspaceRoot` da sessão contra a raiz canônica. Leia status, branch e SHA atuais; use branch, base e merge-base obtidos independentemente da metadata da PR em execução. Preserve quaisquer alterações locais e pare se houver divergência.
2. Confirme a política efetiva da mesma sessão conforme o preflight acima. Se a informação não estiver disponível, permaneça em inspeção read-only e marque as operações mutantes como `BLOCKED`.
3. Trabalhe no escopo da issue: hipótese → teste negativo hermético → correção mínima → reexecução. Use build e validadores do projeto. `bun install --frozen-lockfile` só quando faltar dependência ou o lockfile tiver mudado; não reinstale DSH nem recrie perfil para pequenas PRs. `bun test` completo só depois de demonstrar isolamento de host, credenciais e executáveis externos; se testes puderem iniciar outro harness ou serviço real, marque `BLOCKED` e use os testes herméticos aplicáveis.
4. Revise `git diff --check`, os caminhos staged e o diff completo; faça commit explícito apenas dos arquivos autorizados e atualize a PR draft existente. A revisão deve ser independente; não faça merge ou autoaprovação.
5. Se a validação precisar consumir o produto real, troque de contexto para perfil DSH apropriado e use a trilha `banca-auditor` abaixo; não transforme Creator em sessão acadêmica.

A dependência `file:` pode ser uma cópia, não um link vivo. Não assuma que editar o checkout atualiza o plugin instalado; só sincronize depois de identificar o mecanismo suportado e demonstrar que ele não sobrescreve perfil/estado existente nem dispensa validação de segurança. Caso contrário, reinicie apenas o perfil scratch após revisão humana, ou registre `BLOCKED`. Não execute `--from-default-profile` sobre perfil existente.

## Trilha 2 — validação do produto DSHbanca no preset `banca-auditor`

A declaração estática em [`cordis.patch.yml`](../../cordis.patch.yml) registra `banca-auditor`; só a execução em perfil DSH pode comprovar bundle carregado, associação ao Agent/Session, discovery, dispatch e guardas. `src/dsh.ts` contém verificações de identidade com prefixo `banca-corretor`, mas isso **não** significa que esse preset esteja integralmente implementado ou registrado: o patch inspecionado registra `banca-auditor`.

O gate nativo existente é `bun run e2e:dsh:profile`, documentado em [`docs/dsh-profile-e2e.md`](../dsh-profile-e2e.md). É um gate de produto sem modelo, com workspace/manuscrito sintéticos e dispatch direto pelo `ToolRuntime`. Conforme o documento do gate, a sonda ativa de lifecycle depende de autorização explícita e usa `Agent.send` sintético para rejeitar antes do primeiro passo/model request. **Não execute esse caminho neste slice documental e não use `Agent.send` só para satisfazer um gate.** A descrição do gate ou seu código não equivale a uma execução.

### Gates de produto que precisam ser distinguidos

1. **Bundle e associação:** em perfil DSH scratch, provar que o bundle Cordis carregou e que o preset `banca-auditor` foi resolvido/selecionado por serviços DSH. Correlacionar IDs e objetos do Agent e Session reais; `--dump-config` isolado só prova composição declarada.
2. **Discovery:** listar tools e skills no host e no escopo do Agent pretendido; registrar contagens, integridade e origem. Arquivo em `assets/`, provider registrado ou schema em fixture não prova discovery/associação.
3. **Dispatch e negação:** despachar tools pelo `ToolRuntime` com identidade DSH real e argumentos sintéticos válidos. Tentar `banca_corrigir` e `banca_restore` com efeitos plausíveis; exigir negação de política antes do corpo, zero invocações/marcadores e hashes/inventário imutáveis. Confirmar uma leitura como `banca_status` permitida. Incluir subagente real sem identidade verificada e exigir fail-closed.
4. **Ingestão:** inicializar workspace scratch e ingerir manuscrito LaTeX/BibTeX sintético (por exemplo `main.tex`, `referencias.bib` e capítulos); registrar fingerprints e hashes iniciais/finais. Nunca usar TCC/manuscrito real neste gate.
5. **Plano e cobertura exaustiva:** obter plano canônico, `planId`, fingerprint, `batchId`s e total esperado; verificar que cada lote do plano foi processado e que nenhum lote foi omitido.
6. **Checkpoint, auditoria, proveniência e retomada:** rejeitar avanço antes da confirmação de auditoria; persistir receipt/findings com fingerprint, lote, arquivo, linhas e seção; avançar ordenadamente; reiniciar/retomar contexto e provar que não há avanço espúrio nem duplicação. No E2E atual, `runAcademicBatchAuditProbe` registra `findings: []` e valida `acceptedCount: 0`; portanto isso prova o gate de recibo/avanço, **não** persistência de finding não vazio com proveniência. Esse último subgate precisa de caso sintético dedicado antes de ser alegado.
7. **Síntese global:** chamar `banca_sintese` cedo e exigir rejeição; só depois da cobertura completa aceitar a síntese e conferir `coverage.state === complete`, total concluído e fingerprint esperado. Entradas inválidas/incompletas também devem ser rejeitadas. Isso valida o gate determinístico, não uma redação de modelo nem avaliação acadêmica humana.
8. **Persistência e teardown:** manter perfil/workspace/relatório em scratch exclusivo; comparar inventário/hash do estado acadêmico e manuscrito; descartar `AgentHandle`s e sessions, confirmar fim dos processos e remoção apenas dos recursos criados pelo teste. Se executar o runner, usar `DSHBANCA_DSH_PROFILE_REPORT_PATH` apontando para destino scratch inexistente, para não sobrescrever evidência versionada.

Os detalhes e limitações do runner foram documentados para DSH `0.2.0-rc.2`, Cordis `4.0.4` e loader `1.0.5`; não transfira essas assinaturas automaticamente para `0.2.1-rc.5`. Inspecione os contratos instalados e registre as versões no SHA/execução. O CI convencional só roda esse E2E quando `vars.DSH_PROFILE_E2E_ENABLED == 'true'`; caso contrário, o step é `BLOCKED`, mesmo que o check `validate` esteja verde.

## Matriz de evidências deste slice

| Subgate | Estado neste slice | O que foi/seria provado |
|---|---|---|
| Inspeção local de configuração/código | `PASS` (inspeção) | Patch declara `banca-auditor`; código possui guardas acadêmicas. Não prova carregamento ou dispatch no DSH. |
| Creator real / enforcement da sessão | `BLOCKED` / não executado | A issue #62 acompanha a validação real do Creator. Não inferir permissão da UI, não executar operação sensível sem prova de enforcement. |
| DSHbanca real no preset `banca-auditor` | `BLOCKED` / não executado | `bun run e2e:dsh:profile` foi apenas referenciado/inspecionado neste slice; não declarar E2E executado ou aprovado. |
| Teste do gate com modelo | `BLOCKED` / não executado | Exige autorização separada, modelo/provedor/custo e consentimento de credenciais. |
| UX Web interativa | `BLOCKED` / não executada | Boot não prova seleção, renderização, sessão interativa ou reconexão; demanda separada (#4). |
| Julgamento acadêmico humano | `NOT APPLICABLE` | Nenhuma rubrica, nota, aprovação institucional ou avaliação de texto foi feita. |

O DSH gerencia lifecycle, credenciais, permissões, ferramentas, agents, sessions e plugins. O DSHbanca mantém apenas o domínio acadêmico. Não use OpenCode ou outro harness, não instale plugin em perfil produtivo, não faça bootstrap real neste slice, não use `Agent.send`, modelo pago, token ou manuscrito real. Mantenha cada gate `PASS`, `FAIL` ou `BLOCKED` em sua própria classe de evidência; CI, build, fixture e histórico de outro SHA não substituem execução DSH real.
