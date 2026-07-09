# Extreme Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix security issues, MCP defaults, shell commands, scripts, and validation evidence in OpenBanca repository.

**Architecture:** Implement robust path traversal checks in safe_paths helper and apply to all file operations. Modify MCP configuration to be opt-in via environment variables. Remove shell execution by using spawnSync. Rewrite check-secrets.sh using safe find and read arrays. Document validation claims conservatively.

**Tech Stack:** Bun, TypeScript, Node.js path/fs APIs, Bash.

## Global Constraints
- Do not ask user questions or wait for confirmation.
- Do not push to remote, publish package, or alter license.
- Do not delete original files or invent test results.
- Create a local fix branch and commit local changes.

---

### Task 1: Robust Path Traversal Helper

**Files:**
- Modify: `src/lib/safe_paths.ts`
- Test: `tests/integration.test.ts` (add tests)

**Interfaces:**
- Produces: `resolveInsideRoot`, `relativeInsideRoot`, `sanitizeSnapshotLabel`, `assertInsideRoot`

- [ ] **Step 1: Write robust functions in `src/lib/safe_paths.ts`**
  Ensure we reject absolute paths and paths containing `..` segment. Check prefix using separator to prevent sibling matching.
- [ ] **Step 2: Add test cases to verify path traversal detection**
  Add unit tests to check rejection of absolute paths, `..` patterns, and snapshot labels escaping `.banca/snapshots`.
- [ ] **Step 3: Run bun test**
  Expected: PASS

---

### Task 2: Apply Path Traversal Guards to Tools and Libs

**Files:**
- Modify: `src/tools/banca_corrigir.ts`
- Modify: `src/tools/banca_snapshot.ts`
- Modify: `src/tools/banca_restore.ts`
- Modify: `src/lib/paths.ts`
- Modify: `src/lib/state.ts`

- [ ] **Step 1: Apply safe path checks to `src/tools/banca_corrigir.ts`**
  Validate all correction file inputs and snapshot destination path.
- [ ] **Step 2: Apply safe path checks to `src/tools/banca_snapshot.ts`**
  Validate and sanitize snapshot label, resolve snapDir inside `.banca/snapshots`.
- [ ] **Step 3: Apply safe path checks to `src/tools/banca_restore.ts`**
  Ensure snapshot label does not escape `.banca/snapshots`.
- [ ] **Step 4: Apply safe path checks to `src/lib/paths.ts` and `src/lib/state.ts`**
  Use `resolveInsideRoot` for manuscript and state path resolving.
- [ ] **Step 5: Run bun test**
  Expected: PASS

---

### Task 3: Hardened Opt-In MCP and Fallback

**Files:**
- Modify: `src/lib/config.ts`
- Modify: `src/tools/banca_refs.ts`
- Test: `tests/mcp_client.test.ts`

- [ ] **Step 1: Modify `getMcpCommand` and config default**
  Set `crossrefAcademicEnabled` default to `false`. Modify `getMcpCommand` to check `process.env.OPENBANCA_ENABLE_CROSSREF_MCP === "1"`.
- [ ] **Step 2: Modify `src/tools/banca_refs.ts` fallback**
  If `mcpCmd` is null, prepend fallback message.
- [ ] **Step 3: Add test in `tests/mcp_client.test.ts`**
  Add a test to verify `getMcpCommand` returns `null` by default.
- [ ] **Step 4: Run bun test**
  Expected: PASS

---

### Task 4: Harden check-secrets.sh Script

**Files:**
- Modify: `scripts/check-secrets.sh`

- [ ] **Step 1: Rewrite using Bash arrays without eval**
  Define `find_args` array. Use `find . -type f "${find_args[@]}" -print0 | xargs -0 -r grep -lZ -i -E`.
- [ ] **Step 2: Rewrite env and key file checks**
  Use `find` with `-print0` and NUL-separated loops to avoid spaces-in-filenames bugs.
- [ ] **Step 3: Validate check-secrets.sh runs successfully**
  Run `bash scripts/check-secrets.sh --ci` and `bash scripts/check-secrets.sh --audit`.
  Expected: Success.

---

### Task 5: Adjust Validation Claims and Record Evidence

**Files:**
- Modify: `RELATORIO.md`
- Modify: `docs/installation.md`
- Create: `docs/validation-evidence.md`

- [ ] **Step 1: Update status to VALIDAÇÃO LOCAL DECLARADA**
  Update "VALIDADO" claims in `RELATORIO.md` and `docs/installation.md`.
- [ ] **Step 2: Run all local validations**
  Run `bun install`, `bun run build`, `bun run typecheck`, `bun test`, `bash scripts/validate.sh`, `bash scripts/check-secrets.sh --ci`.
- [ ] **Step 3: Record evidence in `docs/validation-evidence.md`**
  Write down all results, logs, date, and environment details.
