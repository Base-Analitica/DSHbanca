import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  lstatSync,
  type Stats,
} from "node:fs"
import { join, dirname, resolve } from "node:path"
import { resolveInsideRoot, prepareRealPathForWrite } from "./safe_paths"
import {
  AnalysisCheckpointError,
  type AnalysisCheckpoint,
} from "./analysis_checkpoint"
import {
  AnalysisFindingError,
  mergeAnalysisFindings,
  type AnalysisFinding,
} from "./analysis_findings"

export interface ProjectState {
  currentScore: number | null
  lastAudit: string | null
  lastLoop: string | null
  snapshots: Array<{
    id: string
    label: string
    createdAt: string
    scoreBefore: number | null
  }>
  iterations: Array<{
    date: string
    action: string
    scoreBefore: number | null
    scoreAfter: number | null
    status: "ok" | "rollback" | "failed"
  }>
}

export function getStatePath(projectRoot: string): string {
  return resolveInsideRoot(projectRoot, join(".banca", "state.json"))
}

export function loadState(projectRoot: string): ProjectState {
  const p = getStatePath(projectRoot)
  if (!existsSync(p)) return { currentScore: null, lastAudit: null, lastLoop: null, snapshots: [], iterations: [] }
  try {
    return JSON.parse(readFileSync(p, "utf-8"))
  } catch {
    return { currentScore: null, lastAudit: null, lastLoop: null, snapshots: [], iterations: [] }
  }
}

export function saveState(projectRoot: string, state: ProjectState): void {
  const p = prepareRealPathForWrite(projectRoot, getStatePath(projectRoot))
  writeFileSync(p, JSON.stringify(state, null, 2), "utf-8")
}

export function addIteration(
  projectRoot: string,
  action: string,
  scoreBefore: number | null,
  scoreAfter: number | null,
  status: "ok" | "rollback" | "failed",
): void {
  const state = loadState(projectRoot)
  state.iterations.push({ date: new Date().toISOString(), action, scoreBefore, scoreAfter, status })
  state.currentScore = scoreAfter ?? state.currentScore
  saveState(projectRoot, state)
}

export function addSnapshot(projectRoot: string, label: string, scoreBefore: number | null): string {
  const state = loadState(projectRoot)
  // Recovery-point identity must stay unique even when several snapshots are
  // registered within the same millisecond (frozen tests, fast internal
  // producers). Never reuse an id already present in the registry.
  const base = `snap-${Date.now()}`
  let id = base
  let n = 1
  while (state.snapshots.some((s) => s.id === id)) id = `${base}-${++n}`
  state.snapshots.push({ id, label, createdAt: new Date().toISOString(), scoreBefore })
  saveState(projectRoot, state)
  return id
}

// ---------------------------------------------------------------------------
// Shared storage helpers (path containment, symlink refusal, atomic write)
// Domain layers map failures to their own controlled error types.
// ---------------------------------------------------------------------------

/** SHA-256 hex plan identity (64 lowercase hex chars). */
const PLAN_ID_HEX_RE = /^[a-f0-9]{64}$/

function isPlanIdHex(planId: string): boolean {
  return typeof planId === "string" && PLAN_ID_HEX_RE.test(planId)
}

/**
 * lstat without following links. Returns null on ENOENT.
 * Broken symlinks still yield Stats with isSymbolicLink() === true
 * (unlike existsSync, which is false for dangling links).
 * On other I/O failures, invokes onIoError (must throw).
 */
function lstatOrNull(path: string, onIoError: () => never): Stats | null {
  try {
    return lstatSync(path)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === "ENOENT") return null
    return onIoError()
  }
}

type DirEnsureErrors = {
  onLstatFailure: () => never
  onSymlink: (part: string) => never
  onNotDirectory: (part: string) => never
  /** mkdir failed (EACCES, etc.). Must throw a controlled domain error. */
  onMkdirFailure: (part: string) => never
}

/**
 * Walk storage directory components under projectRoot.
 * Refuse any symlink component (live or broken).
 * Creates missing intermediate directories one level at a time (no symlink follow).
 * Never surfaces raw Node FS errors or absolute paths.
 */
function ensureDirPartsNoSymlinks(
  projectRoot: string,
  dirParts: readonly string[],
  errors: DirEnsureErrors,
): string {
  let current = resolve(projectRoot)
  for (const part of dirParts) {
    current = join(current, part)
    const st = lstatOrNull(current, errors.onLstatFailure)
    if (st === null) {
      try {
        mkdirSync(current, { recursive: false })
      } catch {
        // Generic controlled error only — never leak absolute paths or host err.message.
        errors.onMkdirFailure(part)
      }
      continue
    }
    if (st.isSymbolicLink()) {
      errors.onSymlink(part)
    }
    if (!st.isDirectory()) {
      errors.onNotDirectory(part)
    }
  }
  return current
}

type PathInspectErrors = {
  onLstatFailure: () => never
  onSymlink: (part: string) => never
  onNotDirectory: (part: string) => never
}

/**
 * Assert that every existing segment of a relative storage path is not a symlink
 * (including broken symlinks). Does not create directories.
 */
function inspectRelativeStoragePath(
  projectRoot: string,
  parts: readonly string[],
  resolveAbsPath: () => string,
  errors: PathInspectErrors,
): { absPath: string; finalStat: Stats | null } {
  let current = resolve(projectRoot)
  let finalStat: Stats | null = null
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    current = join(current, part)
    const st = lstatOrNull(current, errors.onLstatFailure)
    if (st === null) {
      finalStat = null
      break
    }
    if (st.isSymbolicLink()) {
      errors.onSymlink(part)
    }
    if (i < parts.length - 1 && !st.isDirectory()) {
      errors.onNotDirectory(part)
    }
    if (i === parts.length - 1) {
      finalStat = st
    }
  }
  return {
    absPath: resolveAbsPath(),
    finalStat,
  }
}

/**
 * Same-directory temp file + atomic rename. Removes temp on failure when safe.
 * Never includes host err.message or absolute paths in thrown domain errors
 * (caller's onPersistFailure must use controlled messages only).
 */
function atomicWriteJsonFile(opts: {
  projectRoot: string
  dirAbs: string
  dirRelParts: readonly string[]
  absPath: string
  tmpName: string
  body: string
  onLstatFailure: () => never
  onTargetSymlink: () => never
  onPersistFailure: () => never
}): void {
  const targetStat = lstatOrNull(opts.absPath, opts.onLstatFailure)
  if (targetStat !== null && targetStat.isSymbolicLink()) {
    opts.onTargetSymlink()
  }

  // Containment: write only via the resolved path under projectRoot (do not rebuild).
  const tmpPath = resolveInsideRoot(
    opts.projectRoot,
    join(...opts.dirRelParts, opts.tmpName),
  )

  try {
    writeFileSync(tmpPath, opts.body, { encoding: "utf-8", flag: "wx" })
    renameSync(tmpPath, opts.absPath)
  } catch (err) {
    try {
      const tmpStat = lstatOrNull(tmpPath, () => {
        throw err
      })
      if (tmpStat !== null && !tmpStat.isSymbolicLink()) {
        unlinkSync(tmpPath)
      }
    } catch {
      // Best-effort temp cleanup; original error is rethrown via onPersistFailure.
    }
    // Re-throw controlled domain errors unchanged when callers pre-threw them.
    if (
      err instanceof AnalysisCheckpointError ||
      err instanceof AnalysisFindingsStoreError
    ) {
      throw err
    }
    opts.onPersistFailure()
  }
}

// ---------------------------------------------------------------------------
// AnalysisCheckpoint persistence (dedicated; not part of ProjectState)
// Path: .banca/analysis/checkpoints/<planId>.json
// ---------------------------------------------------------------------------

const CHECKPOINT_DIR_PARTS = [".banca", "analysis", "checkpoints"] as const

const checkpointPathErrors: PathInspectErrors & DirEnsureErrors = {
  onLstatFailure: () => {
    throw new AnalysisCheckpointError(
      "invalid_checkpoint_storage",
      "failed to lstat checkpoint path",
    )
  },
  onSymlink: (part: string) => {
    throw new AnalysisCheckpointError(
      "symlink_refused",
      `refusing symbolic link in checkpoint storage path: ${part}`,
    )
  },
  onNotDirectory: (part: string) => {
    throw new AnalysisCheckpointError(
      "invalid_checkpoint_storage",
      `checkpoint storage path component is not a directory: ${part}`,
    )
  },
  onMkdirFailure: (part: string) => {
    throw new AnalysisCheckpointError(
      "invalid_checkpoint_storage",
      `failed to create checkpoint storage directory: ${part}`,
    )
  },
}

/**
 * Public relative path of a plan checkpoint (POSIX-style, project-relative).
 * Validates planId as SHA-256 hex before use.
 */
export function getAnalysisCheckpointRelativePath(planId: string): string {
  assertValidCheckpointPlanId(planId)
  return `.banca/analysis/checkpoints/${planId}.json`
}

function assertValidCheckpointPlanId(planId: string): void {
  if (!isPlanIdHex(planId)) {
    throw new AnalysisCheckpointError(
      "invalid_plan_id",
      "planId must be a 64-character lowercase hex SHA-256 digest",
    )
  }
}

/**
 * Resolve absolute checkpoint path inside projectRoot.
 * planId is validated as hex; path is constrained by resolveInsideRoot.
 */
function resolveCheckpointAbsPath(projectRoot: string, planId: string): string {
  assertValidCheckpointPlanId(planId)
  return resolveInsideRoot(
    projectRoot,
    join(".banca", "analysis", "checkpoints", `${planId}.json`),
  )
}

function ensureCheckpointDirNoSymlinks(projectRoot: string): string {
  return ensureDirPartsNoSymlinks(
    projectRoot,
    CHECKPOINT_DIR_PARTS,
    checkpointPathErrors,
  )
}

function inspectCheckpointPath(
  projectRoot: string,
  planId: string,
): { absPath: string; finalStat: Stats | null } {
  assertValidCheckpointPlanId(planId)
  return inspectRelativeStoragePath(
    projectRoot,
    [...CHECKPOINT_DIR_PARTS, `${planId}.json`],
    () => resolveCheckpointAbsPath(projectRoot, planId),
    checkpointPathErrors,
  )
}

/**
 * Load the AnalysisCheckpoint for `planId`, or null when the file is absent.
 * Fail-closed on symlink storage (including broken links), malformed JSON, or planId mismatch.
 * Does not invent an empty checkpoint on parse failure.
 */
export function loadAnalysisCheckpoint(
  projectRoot: string,
  planId: string,
): AnalysisCheckpoint | null {
  assertValidCheckpointPlanId(planId)
  const { absPath, finalStat } = inspectCheckpointPath(projectRoot, planId)
  if (finalStat === null) {
    return null
  }
  // Symlinks already refused in inspectCheckpointPath; still require a regular file.
  if (!finalStat.isFile() || finalStat.isSymbolicLink()) {
    if (finalStat.isSymbolicLink()) {
      throw new AnalysisCheckpointError(
        "symlink_refused",
        "refusing to load checkpoint through a symbolic link",
      )
    }
    throw new AnalysisCheckpointError(
      "invalid_checkpoint_storage",
      "checkpoint path exists but is not a regular file",
    )
  }

  let raw: string
  try {
    raw = readFileSync(absPath, "utf-8")
  } catch {
    // Generic message only — never leak absolute paths or host err.message.
    throw new AnalysisCheckpointError(
      "invalid_checkpoint_storage",
      "failed to read checkpoint file",
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new AnalysisCheckpointError(
      "invalid_checkpoint",
      "checkpoint file contains malformed JSON",
    )
  }

  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AnalysisCheckpointError(
      "invalid_checkpoint",
      "checkpoint file must contain a JSON object",
    )
  }

  const obj = parsed as Record<string, unknown>
  if (obj.planId !== planId) {
    throw new AnalysisCheckpointError(
      "incompatible_plan",
      "checkpoint.planId does not match the requested plan identity",
    )
  }

  // Return the parsed object; full structural/compatibility checks run via
  // analysis_checkpoint public APIs (next/complete/create) in the tool.
  return parsed as AnalysisCheckpoint
}

/**
 * Persist `checkpoint` under `.banca/analysis/checkpoints/<planId>.json`.
 * Uses a same-directory temp file + atomic rename. Refuses symlink components
 * and symlink targets (including broken links). Removes the temp file on failure.
 * Never writes absolute paths into the JSON (checkpoint fields are plan-relative / numeric only).
 */
export function saveAnalysisCheckpoint(
  projectRoot: string,
  checkpoint: AnalysisCheckpoint,
): void {
  if (checkpoint == null || typeof checkpoint !== "object") {
    throw new AnalysisCheckpointError(
      "invalid_checkpoint",
      "checkpoint must be an AnalysisCheckpoint object",
    )
  }
  assertValidCheckpointPlanId(checkpoint.planId)

  const dir = ensureCheckpointDirNoSymlinks(projectRoot)
  const absPath = resolveCheckpointAbsPath(projectRoot, checkpoint.planId)
  const tmpName = `.${checkpoint.planId}.${process.pid}.${Date.now()}.tmp`
  const body = JSON.stringify(checkpoint, null, 2)

  atomicWriteJsonFile({
    projectRoot,
    dirAbs: dir,
    dirRelParts: CHECKPOINT_DIR_PARTS,
    absPath,
    tmpName,
    body,
    onLstatFailure: checkpointPathErrors.onLstatFailure,
    onTargetSymlink: () => {
      throw new AnalysisCheckpointError(
        "symlink_refused",
        "refusing to overwrite a checkpoint symbolic link",
      )
    },
    onPersistFailure: () => {
      throw new AnalysisCheckpointError(
        "invalid_checkpoint_storage",
        "failed to persist checkpoint",
      )
    },
  })
}

// ---------------------------------------------------------------------------
// AnalysisFindings store (dedicated; not ProjectState / not checkpoint)
// Path: .banca/analysis/findings/<planId>.json
// ---------------------------------------------------------------------------

/** Wire version of the on-disk findings document. */
export const ANALYSIS_FINDINGS_STORE_VERSION =
  "analysis-findings-store-v1" as const

const FINDINGS_DIR_PARTS = [".banca", "analysis", "findings"] as const

/** Exact key set for analysis-findings-store-v1 (no extras, no missing). */
const FINDINGS_STORE_V1_KEYS = [
  "version",
  "planId",
  "manuscriptFingerprint",
  "findings",
] as const

const FINDINGS_STORE_V1_KEY_SET = new Set<string>(FINDINGS_STORE_V1_KEYS)

/**
 * Versioned on-disk document of validated findings for one plan identity.
 * Never includes absolute paths, timestamps, or host/VM metadata.
 */
export interface AnalysisFindingsStoreV1 {
  version: typeof ANALYSIS_FINDINGS_STORE_VERSION
  planId: string
  manuscriptFingerprint: string
  findings: AnalysisFinding[]
}

/**
 * Controlled error for findings-store path/content failures.
 * Distinct from AnalysisCheckpointError — findings are not checkpoints.
 */
export class AnalysisFindingsStoreError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "AnalysisFindingsStoreError"
    this.code = code
  }
}

const findingsPathErrors: PathInspectErrors & DirEnsureErrors = {
  onLstatFailure: () => {
    throw new AnalysisFindingsStoreError(
      "invalid_findings_storage",
      "failed to lstat findings storage path",
    )
  },
  onSymlink: (part: string) => {
    throw new AnalysisFindingsStoreError(
      "symlink_refused",
      `refusing symbolic link in findings storage path: ${part}`,
    )
  },
  onNotDirectory: (part: string) => {
    throw new AnalysisFindingsStoreError(
      "invalid_findings_storage",
      `findings storage path component is not a directory: ${part}`,
    )
  },
  onMkdirFailure: (part: string) => {
    throw new AnalysisFindingsStoreError(
      "invalid_findings_storage",
      `failed to create findings storage directory: ${part}`,
    )
  },
}

function assertValidFindingsPlanId(planId: string): void {
  if (!isPlanIdHex(planId)) {
    throw new AnalysisFindingsStoreError(
      "invalid_plan_id",
      "planId must be a 64-character lowercase hex SHA-256 digest",
    )
  }
}

/**
 * Public relative path of a plan findings store (POSIX-style, project-relative).
 * Validates planId as SHA-256 hex before use.
 */
export function getAnalysisFindingsRelativePath(planId: string): string {
  assertValidFindingsPlanId(planId)
  return `.banca/analysis/findings/${planId}.json`
}

function resolveFindingsAbsPath(projectRoot: string, planId: string): string {
  assertValidFindingsPlanId(planId)
  return resolveInsideRoot(
    projectRoot,
    join(".banca", "analysis", "findings", `${planId}.json`),
  )
}

function ensureFindingsDirNoSymlinks(projectRoot: string): string {
  return ensureDirPartsNoSymlinks(
    projectRoot,
    FINDINGS_DIR_PARTS,
    findingsPathErrors,
  )
}

function inspectFindingsPath(
  projectRoot: string,
  planId: string,
): { absPath: string; finalStat: Stats | null } {
  assertValidFindingsPlanId(planId)
  return inspectRelativeStoragePath(
    projectRoot,
    [...FINDINGS_DIR_PARTS, `${planId}.json`],
    () => resolveFindingsAbsPath(projectRoot, planId),
    findingsPathErrors,
  )
}

function assertExactStoreKeys(obj: object): void {
  const keys = Object.keys(obj)
  if (keys.length !== FINDINGS_STORE_V1_KEY_SET.size) {
    throw new AnalysisFindingsStoreError(
      "invalid_findings_store",
      `findings store must have exactly ${FINDINGS_STORE_V1_KEY_SET.size} keys for ${ANALYSIS_FINDINGS_STORE_VERSION}`,
    )
  }
  for (const key of keys) {
    if (!FINDINGS_STORE_V1_KEY_SET.has(key)) {
      // Fixed message only — never echo untrusted key names or values.
      throw new AnalysisFindingsStoreError(
        "invalid_findings_store",
        "findings store contains an unknown key",
      )
    }
  }
  for (const required of FINDINGS_STORE_V1_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(obj, required)) {
      // Required names are fixed contract vocabulary, not untrusted input.
      throw new AnalysisFindingsStoreError(
        "invalid_findings_store",
        `findings store is missing required key: ${required}`,
      )
    }
  }
}

/**
 * Fail-closed parse of a findings store document for the requested planId.
 * Validates envelope, runs mergeAnalysisFindings(existing, []) for structure
 * and findingId integrity, and requires each finding to match store identity.
 * Never invents an empty store on failure.
 */
function parseAnalysisFindingsStore(
  parsed: unknown,
  expectedPlanId: string,
): AnalysisFindingsStoreV1 {
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AnalysisFindingsStoreError(
      "invalid_findings_store",
      "findings store file must contain a JSON object",
    )
  }

  assertExactStoreKeys(parsed)
  const obj = parsed as Record<string, unknown>

  if (obj.version !== ANALYSIS_FINDINGS_STORE_VERSION) {
    throw new AnalysisFindingsStoreError(
      "invalid_findings_store",
      `findings store.version must be ${ANALYSIS_FINDINGS_STORE_VERSION}`,
    )
  }

  if (typeof obj.planId !== "string" || obj.planId.length === 0) {
    throw new AnalysisFindingsStoreError(
      "invalid_findings_store",
      "findings store.planId must be a non-empty string",
    )
  }
  if (obj.planId !== expectedPlanId) {
    throw new AnalysisFindingsStoreError(
      "incompatible_plan",
      "findings store.planId does not match the requested plan identity",
    )
  }

  if (
    typeof obj.manuscriptFingerprint !== "string" ||
    obj.manuscriptFingerprint.length === 0
  ) {
    throw new AnalysisFindingsStoreError(
      "invalid_findings_store",
      "findings store.manuscriptFingerprint must be a non-empty string",
    )
  }

  if (!Array.isArray(obj.findings)) {
    throw new AnalysisFindingsStoreError(
      "invalid_findings_store",
      "findings store.findings must be an array",
    )
  }

  let validatedFindings: AnalysisFinding[]
  try {
    // Structural + findingId integrity via shared pure merge (empty incoming).
    validatedFindings = mergeAnalysisFindings(
      obj.findings as AnalysisFinding[],
      [],
    )
  } catch (err) {
    // Fixed public message only — never propagate AnalysisFindingError.message
    // (may echo untrusted finding keys/values).
    if (err instanceof AnalysisFindingError) {
      throw new AnalysisFindingsStoreError(
        "invalid_findings_store",
        "findings store contains invalid findings",
      )
    }
    throw new AnalysisFindingsStoreError(
      "invalid_findings_store",
      "findings store contains invalid findings",
    )
  }

  const storePlanId = obj.planId
  const storeFingerprint = obj.manuscriptFingerprint
  for (let i = 0; i < validatedFindings.length; i++) {
    const f = validatedFindings[i]
    if (f.planId !== storePlanId) {
      throw new AnalysisFindingsStoreError(
        "incompatible_plan",
        `findings store finding[${i}].planId does not match store.planId`,
      )
    }
    if (f.manuscriptFingerprint !== storeFingerprint) {
      throw new AnalysisFindingsStoreError(
        "incompatible_fingerprint",
        `findings store finding[${i}].manuscriptFingerprint does not match store.manuscriptFingerprint`,
      )
    }
  }

  return {
    version: ANALYSIS_FINDINGS_STORE_VERSION,
    planId: storePlanId,
    manuscriptFingerprint: storeFingerprint,
    findings: validatedFindings,
  }
}

/**
 * Load the findings store for `planId`, or null when the file is absent.
 * Fail-closed on symlink storage, non-regular file, malformed/incompatible content.
 * Does not invent an empty store on parse failure and never overwrites the file.
 */
export function loadAnalysisFindings(
  projectRoot: string,
  planId: string,
): AnalysisFindingsStoreV1 | null {
  assertValidFindingsPlanId(planId)
  const { absPath, finalStat } = inspectFindingsPath(projectRoot, planId)
  if (finalStat === null) {
    return null
  }
  if (!finalStat.isFile() || finalStat.isSymbolicLink()) {
    if (finalStat.isSymbolicLink()) {
      throw new AnalysisFindingsStoreError(
        "symlink_refused",
        "refusing to load findings store through a symbolic link",
      )
    }
    throw new AnalysisFindingsStoreError(
      "invalid_findings_storage",
      "findings store path exists but is not a regular file",
    )
  }

  let raw: string
  try {
    raw = readFileSync(absPath, "utf-8")
  } catch {
    throw new AnalysisFindingsStoreError(
      "invalid_findings_storage",
      "failed to read findings store file",
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new AnalysisFindingsStoreError(
      "invalid_findings_store",
      "findings store file contains malformed JSON",
    )
  }

  return parseAnalysisFindingsStore(parsed, planId)
}

/**
 * Persist a findings store under `.banca/analysis/findings/<planId>.json`.
 * Uses same-directory temp + atomic rename. Refuses symlink components and
 * symlink targets (including broken links). Removes temp on failure when safe.
 * Never writes absolute paths, timestamps, or host metadata into the JSON.
 */
export function saveAnalysisFindings(
  projectRoot: string,
  store: AnalysisFindingsStoreV1,
): void {
  if (store == null || typeof store !== "object") {
    throw new AnalysisFindingsStoreError(
      "invalid_findings_store",
      "store must be an AnalysisFindingsStoreV1 object",
    )
  }

  // Validate the document before any write (fail-closed; no partial overwrite).
  const validated = parseAnalysisFindingsStore(store, store.planId)
  assertValidFindingsPlanId(validated.planId)

  const dir = ensureFindingsDirNoSymlinks(projectRoot)
  const absPath = resolveFindingsAbsPath(projectRoot, validated.planId)
  const tmpName = `.${validated.planId}.${process.pid}.${Date.now()}.tmp`

  // Persist only the exact contract keys (no host paths or extras).
  const body = JSON.stringify(
    {
      version: validated.version,
      planId: validated.planId,
      manuscriptFingerprint: validated.manuscriptFingerprint,
      findings: validated.findings,
    } satisfies AnalysisFindingsStoreV1,
    null,
    2,
  )

  atomicWriteJsonFile({
    projectRoot,
    dirAbs: dir,
    dirRelParts: FINDINGS_DIR_PARTS,
    absPath,
    tmpName,
    body,
    onLstatFailure: findingsPathErrors.onLstatFailure,
    onTargetSymlink: () => {
      throw new AnalysisFindingsStoreError(
        "symlink_refused",
        "refusing to overwrite a findings store symbolic link",
      )
    },
    onPersistFailure: () => {
      throw new AnalysisFindingsStoreError(
        "invalid_findings_storage",
        "failed to persist findings store",
      )
    },
  })
}
