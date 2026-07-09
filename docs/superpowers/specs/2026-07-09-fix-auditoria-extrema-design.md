# Design Spec: Fix Extreme Audit Findings for OpenBanca

## Goal
Address security vulnerabilities, hard-coded execution defaults, and script fragility in the OpenBanca repository.

## Approach & Design

### 1. Path Traversal Safety (#6)
- **Helper (`src/lib/safe_paths.ts`)**:
  - `resolveInsideRoot(root, userPath)`: Reject absolute paths (throw `PathTraversalError`). Reject paths containing `..` segment. Resolve using `node:path`. Ensure result is strictly inside the resolved `root` (prevent sibling directory traversal by adding a path separator check).
  - `relativeInsideRoot(root, userPath)`: Return the normalized relative path from `root` to the target.
  - `sanitizeSnapshotLabel(label)`: Permit only alphanumeric characters, `.`, `_`, and `-`. Replace others with `_`. If the label ends up containing `..`, is empty, or is `.`, normalize/sanitize/replace to avoid escape (e.g. replace `..` with `__`).
  - `assertInsideRoot(root, candidate)`: Ensure candidate is within root.
- **Application**:
  - `src/tools/banca_corrigir.ts`: Run `resolveInsideRoot` on each correction target file. Apply allows/protects paths to relative canonized paths.
  - `src/tools/banca_snapshot.ts` & `src/tools/banca_restore.ts`: Ensure the snapshot folder resolves strictly inside `.banca/snapshots`.
  - `src/lib/paths.ts`: Resolve all manuscript paths relative to `projectRoot` safely.
  - `src/lib/state.ts`: Resolve state path using `resolveInsideRoot`.

### 2. MCP Opt-In (#4)
- **Implementation**:
  - Keep `mcp.crossrefAcademicEnabled` as `false` in defaults.
  - `getMcpCommand()` should return `null` unless `crossrefAcademicEnabled` is true AND environment variable `OPENBANCA_ENABLE_CROSSREF_MCP=1` is explicitly set.
  - When MCP command is null, `/banca:refs` operates on fallback (REST/cache) and prepends `MCP não habilitado, validação segue por fallback.` to the returned message.
  - Add test in `tests/mcp_client.test.ts` to verify `getMcpCommand` returns `null` by default.

### 3. execSync Removal (#3)
- Ensure all calls to `execSync` are replaced by safe `spawnSync` invocation with argument arrays. No shell-based string execution.

### 5. check-secrets.sh Hardening (#5)
- Replace any dynamic `eval` with robust Bash arrays `find_args`.
- Use `find` with `-print0` and `xargs -0 -r grep -lZ` (or equivalent) to safely handle spaces in filenames.
- Read results using NUL-separated loops `while IFS= read -r -d '' file; do ... done`.
- Correctly ignore docs/prompts in `--ci` mode.
- Avoid exit failure in `--audit` mode.

### 6. Validation Claims (#2)
- Update status to `VALIDAÇÃO LOCAL DECLARADA — SEM CI / PENDENTE DE CI` in `RELATORIO.md` and `docs/installation.md`.
- Generate `docs/validation-evidence.md` with details of local test runs.
