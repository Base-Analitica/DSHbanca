# Colisão de destinos e imutabilidade de snapshots

Correção focalizada dos dois bloqueios P1 restantes identificados na revisão
independente da PR #1 do DSHbanca (branch `fix/dsh-native-tools`). Este
documento é complementar a `docs/snapshot-restore-reversibility.md` (rodada 2,
identidade lógica e restore não destrutivo) e registra a rodada 3 (colisão de
destinos físicos no restore e imutabilidade de labels de snapshot).

## Escopo e preflight

- Branch: `fix/dsh-native-tools` (já existente; sem branch/PR duplicada).
- Base autorizada: `origin/master`
  (`be4453a9d2b4b42a8c53567e32d8bc39def92d89`), merge-base igual à base.
- SHA inicial revisado: `7eabe833e34f1e42381d16086d862bf886c1e0d7`
  (HEAD local = HEAD remoto da PR no início da tarefa).
- Node `v26.7.0`; Bun `1.4.2`; DSH real instalado `0.2.0-rc.2`
  (`/home/pedro/.local/bin/dsh`). Working tree limpo exceto `.kilo/`
  pré-existente (não tocado).
- PR #1 permaneceu em draft, sem merge, sem force-push e sem nova PR.

## Diagnóstico

**P1-A — colisão de destinos canônicos no restore.** Em `banca_restore`, a
fase 3 validava cada destino isoladamente (`resolveRealInsideRoot` + `isFile`),
sem comparar as identidades físicas entre si, e o loop de escrita (fase 6)
verificava apenas cada escrita logo depois dela. Com dois caminhos lógicos
distintos apontando para o mesmo arquivo físico
(`main.tex -> capitulos/cap1.tex`), as escritas sequenciais faziam a última
substituição vencer: o conteúdo final de `main.tex` não correspondia ao
snapshot e a ferramenta ainda retornava `restored from <label>` com os dois
arquivos listados como restaurados. A ordem de execução decidia o resultado
silenciosamente. Além disso, um symlink interno plantado após o planejamento
podia redirecionar um destino para dentro de `.banca/state.json` ou `.env`
(namespaces protegidos), destruindo estado interno ou segredos.

**P1-B — sobrescrita de snapshots por reutilização de label.** Em
`banca_snapshot`, `ensureRealDirInsideRoot` aceitava diretório já existente,
`captureSnapshotFiles` gravava arquivos e manifesto com `writeFileSync`
(truncando), e `addSnapshot` anexava registro duplicado. Um segundo
`banca_snapshot(label="s1")` destruía o snapshot anterior enquanto
`state.json` acumulava registros ambíguos com o mesmo label. O mesmo padrão de
label colidente existia nos produtores internos baseados apenas em
`Date.now()`: `banca_corrigir` (`pre-<ms>`), backup pré-restore de
`banca_restore` (`pre-restore-<ms>`) e marcador de `banca_loop`
(`loop-<ms>`); com o mesmo milissegundo, o snapshot anterior era sobrescrito.

Condições de reprodução (projetos LaTeX/BibTeX sintéticos, sem manuscritos
reais): dois arquivos do snapshot resolvendo para o mesmo destino físico após
reorganização do projeto; e duas chamadas consecutivas de snapshot com o mesmo
label (ou com `Date.now()` congelado para produtores internos).

## Correção

Correção mínima e centralizada, sem mudança de formato persistido em
`state.json` e sem regressão das 16 ferramentas, do guard nativo ou das
checagens acadêmicas.

- `src/lib/snapshot.ts`: novo ponto único `createSnapshot` (claim exclusivo →
  marcador `.capture-incomplete` → captura → manifesto `wx` → remoção do
  marcador → registro opcional). A etiqueta é recusada de forma determinística
  quando já existe no registro (`already registered in state.json`), quando o
  diretório existe (diretório, symlink ou arquivo inesperado) ou quando o
  manifesto existe (inclusive symlink). Captura/registro que falham removem o
  que a própria chamada criou e nunca registram um snapshot incompleto
  (`SnapshotConflictError` / `SnapshotCaptureError`). Arquivos e manifesto
  passam a usar gravação exclusiva (`flag: "wx"`), sem truncamento possível.
  Política `strict` para `banca_snapshot` (label explícito ou default) e
  `unique` (primeiro sufixo `-N` livre) para produtores internos.
- `src/lib/state.ts`: `addSnapshot` nunca reutiliza um `id` já presente no
  registro (sufixo determinístico), preservando identidade única por ponto de
  recuperação mesmo com o mesmo milissegundo. Formato persistido inalterado.
- `banca_snapshot`: usa `createSnapshot` (`strict`, registrado); mensagens
  `blocked: snapshot label "<label>" is not available (<reason>) — existing
  snapshot data was left untouched` e `blocked: snapshot capture failed — no
  snapshot was registered`.
- `banca_corrigir`: snapshot pré-correção via `createSnapshot` (`unique`, sem
  registro — semântica pública preservada).
- `banca_loop`: marcador via `createSnapshot` (`unique`, registrado) agora com
  manifesto vazio explícito; restauração desses snapshots continua bloqueando
  por não incluir `main.tex`.
- `banca_restore`:
  - Fase 3: todos os destinos planejados são resolvidos canonicamente e
    mapeados por identidade física (`dev:inode` para arquivos existentes,
    caminho canônico para destinos ausentes). Dois caminhos lógicos no mesmo
    arquivo físico → `blocked: restore destinations collide: <a>, <b> resolve to
    the same file (<rel>)`, fail-closed mesmo com conteúdos idênticos e
    independente da ordem. Destinos que resolvem para namespaces protegidos
    (`.env`, `.dsh/`, `.banca/`, `.git/`, `node_modules/`, `dist/`) →
    `blocked: ... resolves into a protected namespace (<reason>)`.
  - Fase 5b: o mesmo mapeamento é revalidado depois do staging/backup e
    imediatamente antes das substituições; qualquer mudança →
    `blocked: restore aborted before writing — <reason>` com o backup
    preservado e zero escritas no manuscrito.
  - Fase 6b: inventário completo final — cada caminho lógico é re-resolvido e
    tem tamanho e SHA-256 reconferidos; qualquer divergência entra no caminho
    de falha/rollback existente
    (`failed: restore aborted at <logical> (final content verification
    failed)`), tornando falso sucesso impossível.
  - Backup pré-restore agora é um snapshot completo via `createSnapshot`
    (`unique`, registrado): nunca sobrescreve um backup anterior e é
    registrado apenas após o manifesto existir.
  - Marcador `.capture-incomplete` no diretório do snapshot →
    `blocked: snapshot is incomplete (capture did not finish) — refusing the
    restore`.

## RED/GREEN

- Suíte nova `tests/snapshot_integrity.test.ts` (22 testes) executa as
  ferramentas reais em projetos sintéticos. Duas corrências no meio da
  operação usam um processo observador externo real (`node`/Bun via
  `child_process`) que faz mutações reais no filesystem — sem mock de módulo e
  sem asserção apenas de string.
- RED sobre `7eabe83` (log): **5 pass / 17 fail**. Provas de falso sucesso
  registradas: `restored from s-race` com `main.tex` físico divergente do
  snapshot (colisão pós-planejamento) e `restored from s-final` com `main.tex`
  corrompido após a escrita (sem verificação final); segundo snapshot
  sobrescrevendo bytes/manifesto/registro do primeiro; backups e marcadores
  internos reutilizando o mesmo label com `Date.now()` congelado.
- GREEN após a correção (log): **22 pass / 0 fail**.

## Prova de colisão física (mapa lógico → canônico)

| Cenário | Lógico A | Lógico B | Destino físico único | Resultado |
| --- | --- | --- | --- | --- |
| A1 conteúdo distinto | `main.tex` | `capitulos/cap1.tex` | `capitulos/cap1.tex` | `blocked` antes de qualquer escrita; árvore do projeto e árvore externa idênticas |
| A2 conteúdo idêntico | `main.tex` | `capitulos/cap1.tex` | `capitulos/cap1.tex` | `blocked` determinístico (fail-closed, sem vencedor silencioso) |
| A8 namespace protegido | `capitulos/cap1.tex` | — | `.banca/state.json` | `blocked`; `state.json` byte a byte preservado |
| A9 namespace protegido | `main.tex` | — | `.env` | `blocked`; `.env` byte a byte preservado |
| A6 colisão pós-planejamento | `main.tex` | `capitulos/cap1.tex` (symlink criado durante o staging) | `main.tex` | `blocked: restore aborted before writing — ... collide ...`; zero escritas |
| A7 corrupção pós-escrita | `main.tex` (corrompido por ator externo) | — | `main.tex` | `failed: ... final content verification failed` + rollback verificado de todos os arquivos aplicados |
| A3/A4/A5 sem colisão | destinos independentes / symlink interno / symlink externo | — | — | restauração normal / link preservado / externo negado e intacto |

## Prova de imutabilidade

- B2 (label registrado reutilizado): bytes do `main.tex` e do capítulo do
  snapshot, hash do manifesto e registros de `state.json` **idênticos** antes e
  depois da tentativa bloqueada; o snapshot original continua restaurável
  (`restored from s1`, conteúdo `VERSAO-A`).
- B3/B4/B5/B6/B7/B8: diretório não registrado, manifesto órfão, snapshot
  legado registrado sem manifesto, label apontando para symlink, label
  colidindo com arquivo regular inesperado e caminho de manifesto
  symlinkizado — todos preservados byte a byte, sem novo registro.
- B10/B11/B12 (labels internos com `Date.now()` congelado): backup pré-restore
  `pre-restore-1700000000000` preservado com `R-V2`; segundo backup em
  `pre-restore-1700000000000-2` com `R-V3`; snapshots pré-correção
  (`pre-...1000` / `-2`) e marcadores de loop (`loop-...2000` / `-2`) com
  registros de label únicos e ids únicos; cada ponto de recuperação restaura a
  própria versão.
- B9 (falha de captura por arquivo ilegível): `blocked: snapshot capture
  failed — no snapshot was registered`, sem diretório parcial, sem manifesto e
  sem registro; manuscrito intacto.
- B13: snapshot com marcador `.capture-incomplete` não é restaurável
  (`blocked: snapshot is incomplete ...`).

## Falhas injetadas e limites de concorrência

- A6 injeta a mudança de destino com um processo externo real entre o
  planejamento e a escrita; a revalidação (fase 5b) aborta sem escrever.
- A7 injeta corrupção real de `main.tex` durante o loop de escrita; a
  verificação final (fase 6b) falha o restore e o rollback verificado devolve
  todos os arquivos ao estado pré-restore (originais preservados).
- B9 injeta EACCES real via `chmod` (pulado como root) e prova limpeza
  integral.
- Concorrência entre processos: o claim é um `mkdir` não recursivo exclusivo —
  dois processos nunca gravam no mesmo diretório; o perdedor falha fechado com
  conflito explícito (não há retry cego, não há sobrescrita silenciosa). Dentro
  do processo, `createSnapshot` é síncrono, sem intercalação entre chamadas.
- TOCTOU residual: permanece a janela entre a revalidação/verificação e a
  operação de filesystem (exigiria `openat`/`O_NOFOLLOW`); mitigada pela
  re-resolução imediata antes de cada escrita e pela verificação final do
  inventário completo.

## Compatibilidade

- Formato persistido de `state.json` inalterado (novo id único apenas evita
  colisão textual; compatível com registros existentes).
- Snapshots legados sem manifesto continuam funcionando pelo fallback de
  planejamento da rodada 2; nunca são sobrescritos por um novo snapshot com o
  mesmo label.
- Manifestos da rodada 2 (versão 1) continuam válidos; snapshots criados por
  esta rodada usam exatamente o mesmo formato.
- `banca_loop` continua registrando snapshots vazios; agora com manifesto
  vazio explícito, e restaurá-los continua bloqueado por não incluir
  `main.tex`.
- Mensagens públicas existentes preservadas (`restored from`, `Safety backup
  created`, `blocked: snapshot path escapes project root`, etc.).

## Evidência de gates

Executados no SHA final (ver descrição da PR #1 para o SHA):

- `bun install --frozen-lockfile` = 0; `bun run typecheck` = 0;
  `bun run build` = 0.
- `bun test tests/snapshot_integrity.test.ts` = 0 (22 pass);
  `bun test tests/snapshot_restore_reversibility.test.ts` = 0 (18 pass);
  `bun test tests/safe_paths_confinement.test.ts` = 0 (25 pass);
  `bun test tests/dsh.test.ts` = 0.
- `bun test` = 1 (654 pass / 1 fail): a única falha é o teste legado
  `real OpenCode: contaminated host config does not load global plugin; local
  banca_init completes`, que já falhava na base isolada (no CI é SKIP por
  ausência do binário OpenCode); não foi alterado, escondido ou reintroduzido.
- `bun run validate:skills` = 0; `bun run validate:agents` = 0;
  `bash scripts/validate.sh` = 0; `bash scripts/check-secrets.sh --ci` = 0;
  `git diff --check` = 0.
- Guard nativo reexecutado no DSH real instalado (subprocesso explícito, dist
  recém-compilado):
  `NATIVE_GUARD_PASS dsh@0.2.0-rc.2: real ToolRuntime registered 16 tools;
  denied auditor and unverified-subagent mutations before body execution;
  allowed verified corrector; scope guard lifecycle verified`.

## Limitações residuais

- Concorrência entre processos no mesmo label: o perdedor do claim falha
  fechado (conflito), não converge automaticamente para um sufixo livre.
- Janela TOCTOU entre verificação e escrita permanece (documentada acima);
  nenhum processo multi-arquivo é chamado de transação atômica.
- A verificação final detecta divergência, mas não impede um ator externo de
  alterar arquivos depois da resposta bem-sucedida.
