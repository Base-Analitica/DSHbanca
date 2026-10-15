# Reversibilidade de snapshots e segurança do restore

Correção focalizada dos defeitos P1 identificados na revisão independente do
DSHbanca (PR #1, branch `fix/dsh-native-tools`).

> Rodada 3 (colisão de destinos físicos no restore e imutabilidade de labels de
> snapshot): ver `docs/snapshot-collision-and-immutability.md`.

## Escopo e preflight

- Branch: `fix/dsh-native-tools` (já existente; sem branch/PR duplicada).
- Base autorizada: `origin/master`
  (`be4453a9d2b4b42a8c53567e32d8bc39def92d89`), merge-base igual à base.
- SHA inicial revisado: `93c8d5fc334b1762ba4968514fd067754b681ee5`
  (HEAD local = HEAD remoto da PR no início da tarefa).
- Node `v26.7.0`; Bun `1.4.2`; DSH real instalado `0.2.0-rc.2`
  (`/home/pedro/.local/bin/dsh`). Working tree limpo exceto `.kilo/`
  pré-existente (não tocado).
- PR #1 permaneceu em draft, sem merge, sem force-push e sem nova PR.

## Diagnóstico

**P1-A — snapshot perde a identidade lógica.** `banca_snapshot` e o snapshot
pré-correção de `banca_corrigir` calculavam a chave do arquivo no cofre com
`relative(canonicalRoot, resolveRealInsideRoot(...))`, ou seja, o caminho
*físico*. Com `main.tex -> texto/main.tex`, o conteúdo era gravado em
`.banca/snapshots/<label>/texto/main.tex`. `banca_restore` procurava o arquivo
no caminho lógico (`snapDir/main.tex`), não o encontrava, omitia `main` do
conjunto de restauração e ainda assim retornava `restored from <label>`.

**P1-B — restore apaga antes de garantir recuperação.** Em `banca_restore`, o
loop fazia `resolveRealInsideRoot` → `rmSync(dstNow, {recursive, force})` →
`ensureRealDirInsideRoot` → `resolveRealInsideRoot` de novo → `cpSync`. Com um
symlink interno válido (`main.tex -> texto/main.tex`), o `rmSync` removia o
arquivo físico real; a re-resolução seguinte falhava no link agora quebrado e o
tool retornava `blocked: restore path escapes project root`, já sem o conteúdo.
O backup de segurança usava a mesma chave física do P1-A, então também não era
restaurável no caso de symlink.

Reprodução isolada confirmou ambos antes da correção (probe sintético): P1-A
manteve `MODIFIED-MAIN` com resposta `restored from`; P1-B retornou `blocked`
depois de apagar `texto/main.tex`.

## Correção

- `src/lib/snapshot.ts` (novo): política única de identidade de snapshot.
  `logicalProjectRel` deriva a chave lógica (POSIX, relativa ao projeto);
  `captureSnapshotFiles` grava em `snapDir/<caminho lógico>`, lê sempre com
  validação canônica (`resolveRealInsideRoot` recusa symlinks externos/quebrados)
  e registra um manifesto `.banca/snapshots/<label>.manifest.json` com
  `logical`, `sha256` e `size` por arquivo, além de `missing` e `skipped`
  (nunca há omissão silenciosa). Caminhos físicos sob `.env`, `.dsh/`,
  `.banca/`, `.git/`, `node_modules/`, `dist/` continuam excluídos por política,
  checados também no caminho físico.
- `banca_snapshot`: usa o capture central; descoberta de capítulos incompleta
  aborta o snapshot (`blocked`) em vez de gravar uma lista parcial; o resultado
  lista capturados, ausentes e excluídos.
- `banca_corrigir`: o snapshot pré-correção usa a mesma política (chave lógica
  via `lexicalProjectPath`, sem `cpSync` próprio). As checagens acadêmicas
  (immutableFacts, protectedPaths, allowedPaths, allowedPaths canônico)
  permaneceram inalteradas.
- `banca_restore`: reescrito em fases. (1) contenção canônica do cofre e do
  estado; (2) planejamento somente-leitura — manifesto é autoritativo
  (existe, é arquivo regular, estrutura e hashes válidos; `main` é obrigatório);
  (3) validação de todos os destinos antes de qualquer escrita (symlink
  externo/quebrado e destino não-regular bloqueiam); (4) staging interno
  verificado em `.banca/snapshots/.restore-staging-*`; (5) backup real do estado
  anterior com a mesma política lógica; (6) substituição controlada por
  `write tmp + rename(2)` no diretório do destino — o destino nunca é apagado
  antes, o que preserva symlinks internos (o link continua e seu alvo real é
  atualizado) — com verificação de hash após cada escrita e rollback reverso do
  que já foi aplicado quando um arquivo falha; rollback parcial é reportado
  como `partial` e o backup é preservado.

## Compatibilidade de snapshots legados

Chave lógica é o formato novo; snapshots antigos (sem manifesto) continuam
legíveis:

| Snapshot legado | Comportamento |
|---|---|
| Sem symlinks (`main.tex` regular) | chave lógica == canônica; restaura normalmente |
| `main`/`bib` simbólico com chave canônica | a chave canônica atual do projeto é derivada de forma determinística e usada como fallback; restauração segura com aviso `Legacy canonical keys used for:` |
| Ambas as cópias presentes no cofre | bloqueio explícito (`ambiguous`); nenhum mapeamento é inventado |
| Sem `main` (ex.: snapshot vazio do `banca_loop`) | bloqueio explícito (`does not include main`) — nunca falso sucesso |
| Manifesto corrompido/tampered, ou com travessia/absoluto | bloqueio explícito antes de tocar o manuscrito |

O formato persistido do `state.json` não mudou; o manifesto é um artefato
adicional do cofre, lido apenas quando presente. Se o mantenedor preferir não
persistir manifesto, o fallback legado cobre os snapshots sem manifesto.

## Testes RED/GREEN

`tests/snapshot_restore_reversibility.test.ts` (novo, 18 testes). No HEAD
vulnerável: **13 falhas / 5 passes** (os 5 passes são controles de regressão que
já se comportavam com segurança: symlink externo no destino, symlink quebrado,
restauração repetida simples, dry-run sem mutação, diretório-pai ausente).
Falhas RED nos dois defeitos: identidade lógica (`texto/main.tex` em vez de
`main.tex`), falso sucesso sem `main`, perda de conteúdo no symlink interno,
exclusão destrutiva de destino-diretório, ausência de manifesto/integridade e
ausência de rollback. Após a correção: **18/18 passes**.

## Prova de reversibilidade (ciclo real)

Projeto sintético com `main.tex -> texto/main.tex`, `referencias.bib`,
`capitulos/cap1.tex`, `capitulos/cap2.tex` → snapshot `s1` → modificação dos
quatro arquivos e remoção de `cap2.tex` → restore `s1` com `confirm: true`.
Resultado verificado por asserções: `restored from s1`; `main.tex` continua
symlink apontando para `texto/main.tex`; hashes sha256 de
`texto/main.tex`, `referencias.bib`, `capitulos/cap1.tex` e
`capitulos/cap2.tex` idênticos aos do estado inicial; lista de restaurados igual
ao inventário; árvore externa inalterada; backup `pre-restore-*` contém o estado
pré-restore (V2) e é ele próprio restaurável (ciclo backup → V2 → s1 → V1).

## Falhas injetadas

- Conteúdo do cofre sem permissão de leitura (chmod 000): planejamento bloqueia,
  manuscrito intacto (nenhum `rmSync` prematuro).
- Diretório-pai do segundo destino sem permissão de escrita (chmod 0555):
  `main` é substituído, `bib` falha, rollback restaura `main` ao conteúdo
  pré-restore e o resultado é `failed ... Rollback restored ...` (sem
  `restored from`). Ambos os testes são pulados quando o processo roda como root
  (chmod não restringe root).
- Limitação conhecida: o ramo de rollback que *falha* (retorno `partial`) é
  implementado e reportado, mas não foi exercitado deterministicamente
  (exigiria injeção no meio da operação); permanece coberto por revisão de
  código, não por teste.

## Limitações residuais

- TOCTOU entre a re-resolução canônica e a escrita: mitigado re-resolvendo
  imediatamente antes de cada escrita e recusando symlinks em todos os
  componentes; não eliminado (exigiria `openat`/`O_NOFOLLOW`).
- Atomicidade multi-arquivo não é transacional: cada arquivo usa `rename(2)`
  atômico, mas uma falha no meio do lote depende do rollback (verificado em
  teste) e é reportada explicitamente como `failed`/`partial`.
- `banca_loop` cria snapshots vazios (marcadores); restaurá-los agora bloqueia
  explicitamente em vez de reportar sucesso vazio.

## Evidência de gates

- `bun install --frozen-lockfile` = 0; `bun run typecheck` = 0;
  `bun run build` = 0.
- `bun test tests/safe_paths_confinement.test.ts` = 0 (25 pass);
  `bun test tests/snapshot_restore_reversibility.test.ts` = 0 (18 pass);
  `bun test tests/dsh.test.ts` = 0.
- `bun test` = 1 (632 pass / 1 fail): a única falha é o teste legado
  `real OpenCode: contaminated host config does not load global plugin; local
  banca_init completes`, que usa `test.skipIf` sem binário OpenCode (por isso
  SKIP no CI) e já falhava na base isolada; não foi alterado.
- `bun run validate:skills` = 0; `bun run validate:agents` = 0;
  `bash scripts/validate.sh` = 0; `bash scripts/check-secrets.sh --ci` = 0;
  `git diff --check` = 0.
- Guard nativo reexecutado no DSH real instalado (mesmo subprocesso do teste):
  `NATIVE_GUARD_PASS dsh@0.2.0-rc.2: real ToolRuntime registered 16 tools;
  denied auditor and unverified-subagent mutations before body execution;
  allowed verified corrector; scope guard lifecycle verified`.

## Publicação

Commit e SHA final são registrados na descrição da PR #1, que permanece draft.
