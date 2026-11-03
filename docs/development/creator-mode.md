# Creator Mode para desenvolvimento do DSHbanca

**Escopo:** usar o Creator do DeepSeek Harness (DSH) como **ambiente de desenvolvimento** do plugin acadêmico DSHbanca. Não instalar Creator nos presets `banca-auditor`/`banca-corretor`, não tratar prompts como autorização de correção e não criar segundo harness. Ver [issue #57](https://github.com/Base-Analitica/DSHbanca/issues/57).

## Estado e versão verificados em 03/11/2026

- Versão adotada para desenvolvimento: `@deepseek-ai/dsh@0.2.1-rc.5` (tag npm `latest` na data). Canal `0.2.2-alpha.3` não adotado.
- A instalação global anterior `0.2.0-rc.2` foi preservada. O Creator usa instalação paralela e `DSH_HOME` **independente**.
- No host DSH real, `creator-dev` compôs `preset-cordis` (Creator), `dshbanca` e `banca-auditor`. O servidor Web iniciou em loopback. Isso comprova **instalação, composição e boot**, não execução por agente ou uso de modelo.
- `pnpm` sinalizou aprovação pendente para skills do pacote. Não aprovar automaticamente todos os pacotes: revisar solicitações e escopo antes de consentir.

## Preparação reproduzível (Linux, Node 22, Bun e pnpm)

> **Bootstrap manual do operador — fora da sessão Creator.** Todos os comandos deste bloco, inclusive instalação, build, testes, criação do perfil, `plugin add` e inicialização do servidor, devem ser executados manualmente pelo mantenedor em um terminal confiável do host, separado da sessão/Agent do DSH. Não os peça ao Creator nem os execute via tool dispatch ou `Agent.send`. O sandbox da sessão Creator não protege esse bootstrap; o preflight abaixo não o autoriza retroativamente. Antes de executar, confira no host que worktree, prefixo e `DSH_HOME` são scratch e isolados, que os destinos ainda não existem quando o bloco exige isso e que o terminal usado tem escopo de escrita apropriado. Se não conseguir verificar esses pontos, pare em `BLOCKED`; não amplie as permissões do Agent para executar o setup.

Defina `WORKTREE` como um **checkout separado da master atual**, sem alterações alheias, e não como o checkout de outra PR.

```bash
# Executar manualmente no terminal do operador, fora do Creator Agent.
export WORKTREE=/caminho/para/DSHbanca-worktree
export DSH_DEV_PREFIX="$HOME/.local/opt/dsh-creator-0.2.1-rc.5"
export DSH_HOME="$HOME/.local/state/dshbanca-creator"
export DSH_CREATOR_CLI="$DSH_DEV_PREFIX/node_modules/@deepseek-ai/dsh/lib/bin.js"

# Não sobrescreva uma instalação paralela preexistente.
test ! -e "$DSH_DEV_PREFIX" &&
  npm install --prefix "$DSH_DEV_PREFIX" --no-audit --no-fund --ignore-scripts --save-exact @deepseek-ai/dsh@0.2.1-rc.5
node "$DSH_CREATOR_CLI" --version

cd "$WORKTREE"
bun install --frozen-lockfile
bun run typecheck
bun run build
bun test
bun run validate:skills
bun run validate:agents
git diff --check

# O flag --from-default-profile substitui o perfil alvo se ele já existir.
# Portanto, use-o somente na PRIMEIRA criação de um perfil novo.
test ! -e "$DSH_HOME/profiles/creator-dev" &&
  node "$DSH_CREATOR_CLI" --profile creator-dev --from-default-profile web --dump-config >/dev/null

node "$DSH_CREATOR_CLI" plugin --profile creator-dev add --ignore-scripts "file:$WORKTREE"
node "$DSH_CREATOR_CLI" --profile creator-dev --dump-config >/dev/null
node "$DSH_CREATOR_CLI" --profile creator-dev --host 127.0.0.1 --port 38087 --no-open
```

O Web imprime uma URL de acesso **com token**. Abra a URL apenas na máquina local; não compartilhe o token em relatórios, PRs, capturas ou logs públicos. Se a porta estiver ocupada, escolha outra porta exclusivamente em loopback.

No Web, selecione **o workspace correspondente ao worktree de desenvolvimento** e o preset **Creator** antes de solicitar trabalho. O preset exibido inicialmente pode ser `Standard mode`: a presença de Creator na configuração não significa que ele foi selecionado. **A primeira atividade no Creator deve ser cumprir o preflight obrigatório abaixo; até concluí-lo, não solicite trabalho nem permita qualquer outra ação, comando ou dispatch do Agent.** Não encaminhe um TCC real para esta sessão.

## Preflight obrigatório de permissões efetivas

O Creator é um preset de desenvolvimento, não um papel acadêmico nem uma fronteira de segurança própria. Antes de qualquer ação, comando ou dispatch iniciado pelo Creator Agent que edite, execute teste que escreva arquivos, altere perfil ou instale plugin, valide **a política efetiva da mesma sessão Agent**; não use o nome visual `Workspace Write` nem `--dump-config` como prova. O bootstrap manual da seção anterior é uma etapa do operador fora dessa sessão e não é autorizado retroativamente por este preflight.

1. Selecione o workspace correspondente ao worktree scratch e registre o `workspaceRoot` canônico esperado.
2. No DSH `0.2.1-rc.5`, consulte `/permission` e selecione `/permission workspace-write` quando necessário. Em seguida, confira o runtime context daquela sessão: modo `workspace-write`, aprovação `ask` e raiz do workspace correta. A seleção visual é apenas uma pista; um valor ausente, `custom`, divergente ou desconhecido bloqueia a tarefa.
3. Quando a verificação Host estiver disponível, confira os contratos públicos instalados: `permissionPresets.current(session)`, `sandboxPolicy.resolve({ session })` e `approval.overrideOf(session)` (com a configuração padrão como fallback). `sandboxPolicy.resolve` usa o `session.cwd` como limite da sessão; `workspaceRoot` configurado é fallback para chamadas sem cwd. Confirme também que `ctx.fs.sandboxMode` e `ctx.shell.sandboxMode` indicam implementações confinadas e que `ctx.sandbox.confine(argv, policy)` retorna execução efetivamente confinada. Para afirmar uma fronteira estrita, exija `enforcement: full`; `partial`, runner ausente, `SANDBOX_UNAVAILABLE` ou impossibilidade de observar o resultado = `BLOCKED`.
4. Se o runtime indicar `danger-full-access`, `never`, raiz errada ou valor não verificável, **não escreva, não execute Plugin Manager e não tente escalar**. Pare, registre `BLOCKED` e solicite decisão humana.

### Configuração nativa DSH verificada

No DSH `0.2.1-rc.5` (Cordis `4.0.5`), o perfil precisa usar os componentes nativos compatíveis: `@deepseek-ai/dsh-sandbox-local` (`ctx.sandbox`), `@deepseek-ai/dsh-sandbox-policy` (modo e raiz fallback), `@deepseek-ai/dsh-fs-sandbox` em vez do filesystem local, `@deepseek-ai/dsh-bash-sandbox` em vez do executor Bash local, `@deepseek-ai/dsh-user-approval` (`ctx.approval`) e, se houver seletor de permissão, `@deepseek-ai/dsh-permission-presets`.

Os valores nativos esperados são:

- `@deepseek-ai/dsh-sandbox-policy`: `mode: workspace-write`; `workspaceRoot` deve corresponder ao worktree e é apenas fallback quando uma sessão não fornece cwd.
- `@deepseek-ai/dsh-permission-presets`: `defaultPreset: workspace-write` e um preset `workspace-write` que combine `sandbox: workspace-write` com `approval: ask`. O default só se aplica a sessões novas; valide a sessão atual separadamente.
- `@deepseek-ai/dsh-user-approval`: `policy: ask`, com um answerer configurado para a sessão. `ask` delega ao waterfall `approval/request`; o serviço não exibe UI por conta própria. Sem answerer, falha de answerer ou resultado indisponível, a operação falha fechada.

O DSH `workspace-write` permite escrita no workspace **e nas raízes temporárias permitidas pelo backend**; não é read-only nem isolamento de container, e não limita rede. O teste abaixo deve usar um alvo fora do workspace **e** fora dessas raízes. Uma tentativa de modo mais amplo só ocorre em uma chamada explícita com `sandbox_permissions` e justificativa; a decisão é one-shot e precede a execução. Nunca trate `never` como substituto de confinamento.

### Prova negativa não destrutiva

Antes de iniciar trabalho de escrita, faça o teste no DSH real com diretório e arquivos exclusivamente sintéticos:

1. Crie dentro do worktree uma pasta temporária com `mktemp -d "$PWD/.creator-permission-probe.XXXXXX"`; adicione somente `main.tex` e `referencias.bib` sintéticos e registre seus SHA-256. Escolha um nome único de marcador no diretório-pai gravável pelo usuário, fora do workspace e de `/tmp`; confirme antes que o marcador não existe.
2. Use a tool nativa `write` para tentar criar somente esse marcador externo, sem `sandbox_permissions` nem justificativa. O resultado esperado é `FS_SANDBOX_DENIED` / `[sandbox: file access denied under workspace-write mode]`; o marcador deve continuar ausente.
3. Repita com o executor Bash confinado usando `printf` para um marcador externo igualmente único. O comando deve ser recusado pelo sandbox. Não aprove nem repita com acesso mais amplo. Se o alvo aparecer, classifique `FAIL`, valide caminho e conteúdo exatos e remova apenas o marcador sintético criado pelo teste.
4. Compare os hashes dos dois fixtures, confirme a ausência dos marcadores e remova a pasta temporária somente depois de verificar com `realpath` que ela permanece sob o workspace. Se o pai externo não for gravável pelo sistema operacional, o teste é inconclusivo, não `PASS`.

**Resultado observado neste ambiente em 03/11/2026, HEAD `277b04c89c359761710f436bb1fbac5b422645ce`:** o runtime context informou `workspace-write` + `ask`; a `write` externa foi recusada com `file access denied under workspace-write mode`; a escrita Bash externa recebeu `EROFS`. Marcadores ausentes, hashes dos fixtures sintéticos inalterados e teardown concluído. Isso prova somente esses dois caminhos no perfil/sessão observados; não declara toda operação do Creator read-only.

## Ciclo de implementação recomendado

1. Selecionar **uma issue-folha**, trabalhar em **uma branch/PR** baseada na `master` verificada e preservar alterações existentes.
2. No Creator, fornecer contexto de `AGENTS.md` e do escopo da issue; solicitar inspeção **nativa** de Cordis, APIs, tools e skills antes de criar infraestrutura. Exigir hipótese, teste negativo e mudança mínima.
3. O executor altera apenas os arquivos permitidos. Depois do build e testes, **reinstalar/sincronizar o bundle local no perfil de desenvolvimento quando necessário** (dependência `file:` do pnpm é uma cópia, não um link vivo); não declarar HMR, recarga ou atualização como comprovados sem inspeção da ativação. Se houver dúvidas, encerrar e reiniciar o perfil de desenvolvimento antes do teste.
4. Revisar diff, resultados e proveniência. E2E DSH/Cordis **no SHA final**, com permissão adequada; reportar `PASS`, `FAIL` ou `BLOCKED` por gate. Publicar PR draft; aplicar revisão independente, correção e merge apenas com gates satisfeitos.
5. O plugin instalado no perfil Creator é **experimental**. A distribuição e os presets acadêmicos permanecem separados, com auditor read-only e mudanças de manuscrito condicionadas a autorização específica.

## Perfis acadêmicos não intercambiáveis

- **Creator:** ambiente de desenvolvimento; pode expor tools mutantes. Não herda o guard acadêmico só por estar no perfil `creator-dev` ou por inspecionar o bundle.
- **`banca-auditor`:** papel acadêmico read-only quando a identidade/preset são realmente associados e validados pelo DSH. Texto ou nome visível não substitui enforcement.
- **`banca-corretor`:** caminho acadêmico destinado a mudanças autorizadas no manuscrito; exige identidade DSH verificável e autorização humana para o escopo. Não transfira esse papel ao Creator.

## Matriz de evidências e limites

| Gate | Estado | Evidência/limite |
|---|---|---|
| Discovery de tools e skills | `PASS` | DSH real listou 16 tools DSHbanca e 8 skills no contexto ativo. |
| Dispatch acadêmico read-only | `PASS` | `banca_checklist` retornou `6/6` em LaTeX/BibTeX sintéticos; nenhum arquivo foi alterado. |
| Escrita fora do workspace | `PASS` (escopo testado) | DSH `write` e Bash confinado recusaram os marcadores externos; hashes preservados e teardown concluído. |
| Segurança geral de escrita do Creator | `FAIL` para alegação ampla | A prova cobre somente esses caminhos/sessão. `workspace-write` permite mutações no workspace e temp roots; Creator não é read-only nem herda o guard do auditor. |
| Prompt/answerer de aprovação em uma operação ampliada | `BLOCKED` | Política efetiva `ask` e contrato one-shot verificados, mas não foi solicitada nem observada uma aprovação interativa; disponibilidade do answerer não foi validada. |
| Inferência, uso de credenciais e instalação demonstrativa | `BLOCKED` / não validados | Nenhum modelo, credencial ou `plugin_manager.install_bundle` foi usado. |
| E2E nativo executado pela CI | `BLOCKED` / não executado | A CI da PR #58 aprovou `validate`, mas o step nativo só roda com `vars.DSH_PROFILE_E2E_ENABLED == 'true'`; sucesso convencional não prova esse E2E. Ver [workflow de CI](../../.github/workflows/ci.yml#L33-L39) e [run da PR #58](https://github.com/Base-Analitica/DSHbanca/actions/runs/41687842806). |

O gerenciador nativo de plugins pode alterar o perfil persistente e carregar código com privilégios do Host. Não usar `pnpm approve --all` ou `plugin_manager.install_bundle` indiscriminadamente. Skills pendentes em `pnpm approve` exigem análise e consentimento pontual. Nenhuma inferência paga, acesso a credenciais de outro perfil, `Agent.send`, mutação acadêmica ou alteração da instalação global é autorizada por este guia.

Evite executar `--from-default-profile` sobre perfil existente: ele substitui o estado da configuração. Não inclua em commits `DSH_HOME`, credenciais, tokens, perfis instalados, `node_modules` ou manuscritos. Para retornar ao ambiente anterior, encerre o Creator e continue usando o `dsh` global não modificado. Não apague dados de perfil sem revisão humana.
