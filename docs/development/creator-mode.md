# Creator Mode para desenvolvimento do DSHbanca

**Escopo:** usar o Creator do DeepSeek Harness (DSH) como **ambiente de desenvolvimento** do plugin acadêmico DSHbanca. Não instalar Creator nos presets `banca-auditor`/`banca-corretor`, não tratar prompts como autorização de correção e não criar segundo harness. Ver [issue #57](https://github.com/Base-Analitica/DSHbanca/issues/57).

## Estado e versão verificados em 03/11/2026

- Versão adotada para desenvolvimento: `@deepseek-ai/dsh@0.2.1-rc.5` (tag npm `latest` na data). Canal `0.2.2-alpha.3` não adotado.
- A instalação global anterior `0.2.0-rc.2` foi preservada. O Creator usa instalação paralela e `DSH_HOME` **independente**.
- No host DSH real, `creator-dev` compôs `preset-cordis` (Creator), `dshbanca` e `banca-auditor`. O servidor Web iniciou em loopback. Isso comprova **instalação, composição e boot**, não execução por agente ou uso de modelo.
- `pnpm` sinalizou aprovação pendente para skills do pacote. Não aprovar automaticamente todos os pacotes: revisar solicitações e escopo antes de consentir.

## Preparação reproduzível (Linux, Node 22, Bun e pnpm)

Defina `WORKTREE` como um **checkout separado da master atual**, sem alterações alheias, e não como o checkout de outra PR.

```bash
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

No Web, selecione **o workspace correspondente ao worktree de desenvolvimento** e o preset **Creator** antes de solicitar trabalho. O preset exibido inicialmente pode ser `Standard mode`: a presença de Creator na configuração não significa que ele foi selecionado. Não encaminhe um TCC real para esta sessão.

## Ciclo de implementação recomendado

1. Selecionar **uma issue-folha**, trabalhar em **uma branch/PR** baseada na `master` verificada e preservar alterações existentes.
2. No Creator, fornecer contexto de `AGENTS.md` e do escopo da issue; solicitar inspeção **nativa** de Cordis, APIs, tools e skills antes de criar infraestrutura. Exigir hipótese, teste negativo e mudança mínima.
3. O executor altera apenas os arquivos permitidos. Depois do build e testes, **reinstalar/sincronizar o bundle local no perfil de desenvolvimento quando necessário** (dependência `file:` do pnpm é uma cópia, não um link vivo); não declarar HMR, recarga ou atualização como comprovados sem inspeção da ativação. Se houver dúvidas, encerrar e reiniciar o perfil de desenvolvimento antes do teste.
4. Revisar diff, resultados e proveniência. E2E DSH/Cordis **no SHA final**, com permissão adequada; reportar `PASS`, `FAIL` ou `BLOCKED` por gate. Publicar PR draft; aplicar revisão independente, correção e merge apenas com gates satisfeitos.
5. O plugin instalado no perfil Creator é **experimental**. A distribuição e os presets acadêmicos permanecem separados, com auditor read-only e mudanças de manuscrito condicionadas a autorização específica.

## Portas de segurança e limites

- O gerenciador nativo de plugins pode modificar o perfil persistente e carregar código com privilégios do Host. **Nunca** usar `--danger-full-access`, `pnpm approve --all` ou `plugin_manager.install_bundle` indiscriminadamente.
- Skills pendentes em `pnpm approve` exigem análise e aprovação pontual. Não contornar a proteção apenas para obter um indicador verde.
- Nenhuma inferência paga, acesso a credenciais salvas de outro perfil, `Agent.send`, mutação acadêmica ou alteração da instalação global é autorizada por este guia.
- `--dump-config` comprova montagem declarativa, não a ativação do plugin, discovery/dispatch de ferramentas ou funcionamento interativo com o modelo. O boot Web não substitui os E2E acadêmicos.
- Evite executar `--from-default-profile` sobre perfil já usado: o comando **substitui** o estado da configuração desse perfil.
- Não incluir em commits o `DSH_HOME`, credenciais, tokens, perfis instalados, `node_modules` ou manuscritos. Para retornar ao ambiente anterior, encerre o servidor Creator e continue usando o `dsh` global não modificado. Não apague dados de perfil sem revisão humana.
