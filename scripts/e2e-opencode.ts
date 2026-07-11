import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  accessSync,
  constants,
} from "node:fs";
import { join, delimiter, resolve, relative, isAbsolute } from "node:path";
import { tmpdir, homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const AGENTS_REQUIRED = ["banca-auditor", "banca-corretor", "banca-fontes", "banca-integrador", "banca-loop"];
const SKILLS_REQUIRED = [
  "banca-avaliacao",
  "banca-correcao",
  "banca-detector-ia",
  "banca-grille",
  "banca-plagio",
  "banca-planejador",
  "banca-referencias",
  "banca-revisor",
];

const DIST_STAMP_NAME = ".e2e-build-stamp.json";
const SOURCE_FINGERPRINT_PATHS = [
  "package.json",
  "tsconfig.json",
  "src/index.ts",
  "src/lib",
  "src/tools",
];

export type Outcome = "PASS" | "FAIL" | "BLOCKED";

export type ProcessLike = {
  stdout?: string | null;
  stderr?: string | null;
  status: number | null;
  signal?: NodeJS.Signals | null;
  error?: Error | null;
};

/** OpenCode 1.17 tool event after normalization (flat or nested `part`). */
export type NormalizedToolEvent = {
  tool?: string;
  callId?: string;
  status?: string;
  input?: unknown;
  output?: unknown;
  error?: unknown;
  rawType?: string;
  malformed?: boolean;
  /** Index in original event list for ordering checks. */
  index?: number;
};

export type InitEval = {
  foundTool: boolean;
  foundSuccess: boolean;
  hasProjectJson: boolean;
  hasStateJson: boolean;
  exactAgents: boolean;
  exactSkills: boolean;
  skillMdCount: number;
};

export type ProtocolEval = {
  skillArgsCorrect: boolean;
  skillEvidence: boolean;
  /** True only when the skill tool call is correlated and isToolSuccess(). */
  skillSucceeded: boolean;
  contextCalled: boolean;
  auditarCalled: boolean;
  correctOrder: boolean;
  hashesMatch: boolean;
  claimedSubagentWithoutEvidence: boolean;
};

/** FAIL always wins over BLOCKED; only all-PASS yields PASS. */
export function combineOutcomes(...outcomes: Outcome[]): Outcome {
  if (outcomes.includes("FAIL")) return "FAIL";
  if (outcomes.includes("BLOCKED")) return "BLOCKED";
  return "PASS";
}

export function outcomeToExitCode(outcome: Outcome): number {
  if (outcome === "PASS") return 0;
  if (outcome === "BLOCKED") return 2;
  return 1;
}

export function isTimedOut(result: ProcessLike): boolean {
  const err = result.error as (Error & { code?: string }) | null | undefined;
  return Boolean(err && err.code === "ETIMEDOUT") || result.signal === "SIGTERM";
}

export function parseJsonEvents(raw: string): any[] {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (typeof parsed === "object" && parsed !== null) return [parsed];
  } catch {}

  const events: any[] = [];
  const lines = raw.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  for (const line of lines) {
    try {
      events.push(JSON.parse(line));
    } catch {}
  }
  return events;
}

/**
 * Normalize OpenCode 1.17 `run --format json` tool events and legacy flat fixtures.
 *
 * Real shape (from packages/opencode/src/cli/cmd/run.ts):
 * `{ type: "tool_use", part: { type: "tool", tool, callID, id, state: { status, input, output, error } } }`
 */
export function normalizeToolEvent(event: any, index?: number): NormalizedToolEvent | null {
  if (event === null || event === undefined) {
    return { malformed: true, index };
  }
  if (typeof event !== "object") {
    return { malformed: true, index };
  }

  // Nested OpenCode part format
  if (event.part && typeof event.part === "object") {
    const part = event.part;
    const isToolPart =
      part.type === "tool" ||
      event.type === "tool_use" ||
      typeof part.tool === "string";

    if (!isToolPart) return null;

    const state = part.state && typeof part.state === "object" ? part.state : {};
    return {
      tool: part.tool || part.toolName || part.name,
      callId: part.callID || part.call_id || part.id || event.callID,
      status: state.status || state.state || part.status,
      input: state.input ?? state.args ?? part.input ?? part.args,
      output: state.output ?? state.result ?? part.output ?? part.result,
      error: state.error ?? part.error ?? event.error,
      rawType: event.type,
      index,
    };
  }

  // Flat / synthetic legacy fixtures used in unit tests
  if (event.type === "tool_result") {
    return {
      tool: event.toolName || event.tool || event.name,
      callId: event.id || event.call_id || event.callID,
      status: event.state || event.status,
      input: event.args || event.arguments || event.input,
      output: event.result || event.output,
      error: event.error,
      rawType: event.type,
      index,
    };
  }

  const tool = event.toolName || event.tool || event.name;
  if (!tool && !event.state && !event.status && !event.result && !event.output) {
    return null;
  }

  return {
    tool,
    callId: event.id || event.call_id || event.callID,
    status: event.state || event.status,
    input: event.args || event.arguments || event.input,
    output: event.result || event.output,
    error: event.error,
    rawType: event.type,
    index,
  };
}

export function normalizeAllToolEvents(events: any[]): NormalizedToolEvent[] {
  const out: NormalizedToolEvent[] = [];
  for (let i = 0; i < events.length; i++) {
    const n = normalizeToolEvent(events[i], i);
    if (n) out.push(n);
  }
  return out;
}

export function isToolSuccess(n: NormalizedToolEvent | null | undefined): boolean {
  if (!n || n.malformed) return false;
  if (n.error !== undefined && n.error !== null && n.error !== false && n.error !== "") {
    return false;
  }
  const status = (n.status || "").toLowerCase();
  if (status === "error" || status === "failed") return false;
  if (status === "completed" || status === "success") return true;
  // incomplete / running / pending / missing status — not success
  return false;
}

function outputText(output: unknown): string {
  if (typeof output === "string") return output;
  if (output && typeof output === "object") {
    const o = output as Record<string, unknown>;
    if (typeof o.content === "string") return o.content;
    if (typeof o.text === "string") return o.text;
    try {
      return JSON.stringify(output);
    } catch {
      return "";
    }
  }
  return "";
}

function inputName(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const o = input as Record<string, unknown>;
  if (typeof o.name === "string") return o.name;
  return undefined;
}

export function verifyAgents(output: string, projectRoot?: string): string {
  const observed = Array.from(output.matchAll(/^([a-z0-9-]+)\s*\(/gm)).map((m) => m[1]);
  const uniqueObserved = Array.from(new Set(observed));
  const missing = AGENTS_REQUIRED.filter((a) => !uniqueObserved.includes(a));
  const unexpected = uniqueObserved.filter(
    (a) => !AGENTS_REQUIRED.includes(a) && a.startsWith("banca-")
  );

  if (missing.length > 0) {
    return `NO_MODEL_DISCOVERY_FAILED — missing agents: ${missing.join(", ")}`;
  }
  if (unexpected.length > 0) {
    return `NO_MODEL_DISCOVERY_FAILED — unexpected agents: ${unexpected.join(", ")}`;
  }

  if (projectRoot) {
    const missingLocal: string[] = [];
    for (const a of AGENTS_REQUIRED) {
      const p = join(projectRoot, ".opencode", "agents", `${a}.md`);
      if (!existsSync(p)) missingLocal.push(a);
    }
    if (missingLocal.length > 0) {
      return `NO_MODEL_DISCOVERY_FAILED — agents not present under project .opencode/agents: ${missingLocal.join(", ")}`;
    }
  }

  return "NO_MODEL_DISCOVERY_PASSED";
}

/**
 * Skills discovery must prove provenance from the temporary project `.opencode/skills`.
 * A global copy with the same names must not satisfy the check.
 */
export function verifySkills(output: string, projectRoot?: string): string {
  // Prefer structured JSON (debug skill emits an array with location fields).
  let entries: Array<{ name?: string; location?: string }> = [];
  try {
    const parsed = JSON.parse(output);
    if (Array.isArray(parsed)) entries = parsed;
  } catch {
    const events = parseJsonEvents(output);
    if (events.length === 1 && Array.isArray(events[0])) {
      entries = events[0];
    } else if (events.every((e) => e && typeof e === "object" && "name" in e)) {
      entries = events;
    } else {
      const observed = Array.from(output.matchAll(/"name":\s*"([^"]+)"/g)).map((m) => m[1]);
      entries = observed.map((name) => ({ name }));
    }
  }

  const byName = new Map<string, { name?: string; location?: string }>();
  for (const e of entries) {
    if (e && typeof e.name === "string") byName.set(e.name, e);
  }

  const missing = SKILLS_REQUIRED.filter((s) => !byName.has(s));
  const unexpected = Array.from(byName.keys()).filter(
    (n) => n.startsWith("banca-") && !SKILLS_REQUIRED.includes(n)
  );

  if (missing.length > 0) {
    return `NO_MODEL_DISCOVERY_FAILED — missing skills: ${missing.join(", ")}`;
  }
  if (unexpected.length > 0) {
    return `NO_MODEL_DISCOVERY_FAILED — unexpected skills: ${unexpected.join(", ")}`;
  }

  if (projectRoot) {
    const rootResolved = resolve(projectRoot);
    const badProvenance: string[] = [];
    for (const s of SKILLS_REQUIRED) {
      const entry = byName.get(s)!;
      const loc = entry.location;
      const expectedDir = resolve(rootResolved, ".opencode", "skills", s);
      const expectedFile = join(expectedDir, "SKILL.md");
      if (!loc) {
        badProvenance.push(`${s} (missing location)`);
        continue;
      }
      const locResolved = resolve(loc);
      const underProject =
        locResolved === expectedFile ||
        locResolved.startsWith(expectedDir + "/") ||
        locResolved.startsWith(expectedDir + "\\");
      if (!underProject) {
        badProvenance.push(`${s} (location outside project .opencode/skills)`);
      }
      if (!existsSync(expectedFile)) {
        badProvenance.push(`${s} (local SKILL.md absent)`);
      }
    }
    if (badProvenance.length > 0) {
      return `NO_MODEL_DISCOVERY_FAILED — skill provenance: ${badProvenance.join("; ")}`;
    }
  }

  return "NO_MODEL_DISCOVERY_PASSED";
}

export function verifyInitEvents(events: any[]) {
  // Bare tool_result without a call is never a successful banca_init invocation.
  if (events.length === 1 && events[0]?.type === "tool_result") {
    return { foundTool: false, foundSuccess: false };
  }

  const normalized = normalizeAllToolEvents(events);
  let foundTool = false;
  const callIds = new Set<string>();
  const successIds = new Set<string>();
  const errorIds = new Set<string>();
  let anonymousSuccess = false;

  for (const n of normalized) {
    if (!n || n.malformed) continue;

    const isInit = n.tool === "banca_init";
    const isCallLike = isInit && n.rawType !== "tool_result";

    if (isCallLike) {
      foundTool = true;
      if (n.callId) callIds.add(n.callId);
    }

    // Correlated follow-ups (same callId) even if tool field omitted
    const correlated = Boolean(n.callId && callIds.has(n.callId));
    if (!isInit && !correlated) continue;

    // tool_result with tool name but no prior call: ignore
    if (n.rawType === "tool_result" && isInit && !correlated && callIds.size === 0) {
      continue;
    }

    if (n.callId) {
      const status = (n.status || "").toLowerCase();
      if (n.error || status === "error" || status === "failed") {
        errorIds.add(n.callId);
        successIds.delete(n.callId);
      } else if (isToolSuccess(n)) {
        if (!errorIds.has(n.callId) && (callIds.has(n.callId) || isCallLike)) {
          if (isCallLike) callIds.add(n.callId);
          successIds.add(n.callId);
        }
      }
    } else if (isCallLike && isToolSuccess(n)) {
      anonymousSuccess = true;
    }
  }

  // Flat fixtures: call event then success event with same id (status on second)
  for (const n of normalized) {
    if (!n.callId || !callIds.has(n.callId)) continue;
    const status = (n.status || "").toLowerCase();
    if (n.error || status === "error" || status === "failed") {
      errorIds.add(n.callId);
      successIds.delete(n.callId);
      continue;
    }
    if (status === "completed" || status === "success") {
      if (!errorIds.has(n.callId)) successIds.add(n.callId);
    }
    // legacy flat: result without status on correlated id
    if (!n.status && n.output && !n.error && callIds.has(n.callId) && !errorIds.has(n.callId)) {
      successIds.add(n.callId);
    }
  }

  const foundSuccess =
    anonymousSuccess || Array.from(successIds).some((id) => callIds.has(id));

  return { foundTool, foundSuccess };
}

function hasSkillEvidenceText(output: unknown): boolean {
  const text = outputText(output);
  return (
    text.includes("# Skill: Banca Avaliação") ||
    text.includes('name="banca-avaliacao"') ||
    text.includes("name: banca-avaliacao")
  );
}

function isExplicitToolFailure(n: { status?: string; error?: unknown }): boolean {
  if (n.error !== undefined && n.error !== null && n.error !== false && n.error !== "") {
    return true;
  }
  const status = (n.status || "").toLowerCase();
  return status === "error" || status === "failed";
}

/**
 * Permanent fail-closed protocol verification.
 * - Each tool tracks exactly one callId (the first call).
 * - Only events with that same callId may contribute args, evidence, success, or errors.
 * - A different callId of the same tool name is ignored for that track.
 * - correctOrder uses the indices of the calls that actually succeeded.
 * - Output without completed/success status never proves success.
 */
export function verifyProtocolEvents(events: any[]) {
  const normalized = normalizeAllToolEvents(events);

  type Track = {
    callId?: string;
    callIdx: number;
    successIdx: number;
    argsOk: boolean;
    evidence: boolean;
    succeeded: boolean;
    errored: boolean;
  };

  const skill: Track = {
    callIdx: -1,
    successIdx: -1,
    argsOk: false,
    evidence: false,
    succeeded: false,
    errored: false,
  };
  const context: Track = {
    callIdx: -1,
    successIdx: -1,
    argsOk: true,
    evidence: true,
    succeeded: false,
    errored: false,
  };
  const auditar: Track = {
    callIdx: -1,
    successIdx: -1,
    argsOk: true,
    evidence: true,
    succeeded: false,
    errored: false,
  };

  const isTrackedCall = (track: Track, eventCallId: string | undefined): boolean => {
    // No call established yet.
    if (track.callIdx === -1) return false;
    // Both sides missing id (rare): only accept if track also has no callId.
    if (track.callId === undefined && eventCallId === undefined) return true;
    // Strict: event must share the locked callId.
    return track.callId !== undefined && eventCallId === track.callId;
  };

  const lockCall = (track: Track, n: NormalizedToolEvent, idx: number) => {
    if (track.callIdx !== -1) return false;
    track.callIdx = idx;
    track.callId = n.callId;
    return true;
  };

  const applyToTrack = (
    track: Track,
    n: NormalizedToolEvent,
    idx: number,
    opts: { requireArgsAndEvidence: boolean }
  ) => {
    if (track.errored) {
      track.succeeded = false;
      return;
    }

    if (opts.requireArgsAndEvidence) {
      const name = inputName(n.input);
      if (name === "banca-avaliacao") track.argsOk = true;
      if (hasSkillEvidenceText(n.output)) track.evidence = true;
    }

    if (isExplicitToolFailure(n)) {
      track.errored = true;
      track.succeeded = false;
      track.successIdx = -1;
      return;
    }

    if (!isToolSuccess(n)) return;
    if (track.errored) return;
    if (opts.requireArgsAndEvidence && !(track.argsOk && track.evidence)) return;

    track.succeeded = true;
    if (track.successIdx === -1) track.successIdx = idx;
  };

  for (const n of normalized) {
    if (!n || n.malformed) continue;
    const idx = n.index ?? -1;
    const isCallLike = n.rawType !== "tool_result";

    // --- skill: lock first skill call only ---
    if (n.tool === "skill" && isCallLike) {
      if (skill.callIdx === -1) {
        lockCall(skill, n, idx);
        applyToTrack(skill, n, idx, { requireArgsAndEvidence: true });
      } else if (isTrackedCall(skill, n.callId)) {
        applyToTrack(skill, n, idx, { requireArgsAndEvidence: true });
      }
      // Different skill callId: ignored entirely for this track.
      continue;
    }
    if (isTrackedCall(skill, n.callId) && (n.tool === "skill" || !n.tool)) {
      // Correlated follow-up without tool name (flat result) or tool_result style.
      applyToTrack(skill, n, idx, { requireArgsAndEvidence: true });
      continue;
    }

    // --- banca_context ---
    if (n.tool === "banca_context" && isCallLike) {
      if (context.callIdx === -1) {
        lockCall(context, n, idx);
        applyToTrack(context, n, idx, { requireArgsAndEvidence: false });
      } else if (isTrackedCall(context, n.callId)) {
        applyToTrack(context, n, idx, { requireArgsAndEvidence: false });
      }
      continue;
    }
    if (isTrackedCall(context, n.callId) && (n.tool === "banca_context" || !n.tool)) {
      applyToTrack(context, n, idx, { requireArgsAndEvidence: false });
      continue;
    }

    // --- banca_auditar ---
    if (n.tool === "banca_auditar" && isCallLike) {
      if (auditar.callIdx === -1) {
        lockCall(auditar, n, idx);
        applyToTrack(auditar, n, idx, { requireArgsAndEvidence: false });
      } else if (isTrackedCall(auditar, n.callId)) {
        applyToTrack(auditar, n, idx, { requireArgsAndEvidence: false });
      }
      continue;
    }
    if (isTrackedCall(auditar, n.callId) && (n.tool === "banca_auditar" || !n.tool)) {
      applyToTrack(auditar, n, idx, { requireArgsAndEvidence: false });
    }
  }

  // Final vetoes
  if (skill.errored) skill.succeeded = false;
  if (context.errored) context.succeeded = false;
  if (auditar.errored) auditar.succeeded = false;
  if (!skill.argsOk || !skill.evidence) skill.succeeded = false;
  if (!skill.succeeded) skill.successIdx = -1;
  if (!context.succeeded) context.successIdx = -1;
  if (!auditar.succeeded) auditar.successIdx = -1;

  // Order is based on the calls that actually succeeded, not the first sighting of a tool name.
  const correctOrder =
    skill.succeeded &&
    context.succeeded &&
    auditar.succeeded &&
    skill.successIdx !== -1 &&
    context.successIdx !== -1 &&
    auditar.successIdx !== -1 &&
    skill.successIdx < context.successIdx &&
    context.successIdx < auditar.successIdx;

  return {
    skillArgsCorrect: skill.argsOk,
    skillEvidence: skill.evidence,
    skillSucceeded: skill.succeeded,
    contextCalled: context.succeeded,
    auditarCalled: auditar.succeeded,
    correctOrder,
  };
}

/** Categories that must force FAIL even when process exit code is 0. */
export function hasStructuredProtocolFailure(categories: string[]): boolean {
  return categories.some(
    (c) =>
      c === "opencode_error_event" ||
      c === "opencode_internal_error" ||
      c.startsWith("tool_error")
  );
}

/**
 * Detect CLI fallback when a subagent is requested via --agent.
 * banca-auditor is mode:subagent and cannot be used as primary.
 */
export function detectAgentAttribution(params: {
  requestedAgent?: string | null;
  stderr?: string;
  stdout?: string;
}): {
  requested: string | null;
  observed: string;
  fallback: boolean;
  canClaimSubagent: boolean;
  reason: string;
} {
  const requested = params.requestedAgent || null;
  const combined = `${params.stderr || ""}\n${params.stdout || ""}`;
  const subagentFallback =
    /is a subagent,\s*not a primary agent/i.test(combined) ||
    /Falling back to default agent/i.test(combined);

  if (!requested) {
    return {
      requested: null,
      observed: "primary-default",
      fallback: false,
      canClaimSubagent: false,
      reason: "no --agent flag; execution uses OpenCode primary agent",
    };
  }

  if (requested === "banca-auditor" || subagentFallback) {
    return {
      requested,
      observed: "primary-default",
      fallback: true,
      canClaimSubagent: false,
      reason: `agent "${requested}" is a subagent or CLI fell back to default primary`,
    };
  }

  return {
    requested,
    observed: requested,
    fallback: false,
    canClaimSubagent: true,
    reason: `agent "${requested}" accepted as primary`,
  };
}

export function createPathSanitizer(roots: {
  home?: string;
  repoRoot?: string;
  tempRoots?: string[];
}) {
  const replacements: Array<{ from: string; to: string }> = [];
  const add = (from: string | undefined, to: string) => {
    if (!from) return;
    const abs = resolve(from);
    replacements.push({ from: abs, to });
    // file URL form
    try {
      replacements.push({ from: pathToFileURL(abs).href, to: `file://${to}` });
    } catch {}
  };

  add(roots.home, "<HOME>");
  add(roots.repoRoot, "<REPO>");
  for (const t of roots.tempRoots || []) add(t, "<TMP>");
  // longest first
  replacements.sort((a, b) => b.from.length - a.from.length);

  return (text: string): string => {
    let out = text;
    for (const { from, to } of replacements) {
      if (!from) continue;
      out = out.split(from).join(to);
      // also forward-slash normalized on windows-like
      out = out.split(from.replace(/\\/g, "/")).join(to);
    }
    return out;
  };
}

export function sanitizeOutput(
  out: string,
  maxLength: number = 1000,
  pathSanitizer?: (s: string) => string
): string {
  if (!out) return "";
  let sanitized = out.trim();
  if (pathSanitizer) sanitized = pathSanitizer(sanitized);

  // Tokens / secrets (including punctuation-bearing values). Bearer first so
  // "Authorization: Bearer <token>" does not leave the token after redacting Bearer.
  sanitized = sanitized.replace(
    /(bearer\s+)[a-zA-Z0-9_\-\.=+/]+/gi,
    "$1[REDACTED]"
  );
  sanitized = sanitized.replace(
    /([a-zA-Z0-9_-]*(?:api[_-]?key|token|secret|password|passwd|authorization)[a-zA-Z0-9_-]*\s*[:=]\s*)(["']?)([^\s"'\\]+)(["']?)/gi,
    "$1$2[REDACTED]$4"
  );
  sanitized = sanitized.replace(
    /\b(sk-[a-zA-Z0-9_\-\.=+/]{8,}|sk-or-v1-[a-zA-Z0-9_\-\.=+/]{8,}|ghp_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,}|xox[baprs]-[a-zA-Z0-9-]{10,})\b/g,
    "[REDACTED]"
  );
  sanitized = sanitized.replace(
    /\b[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY)[A-Z0-9_]*\s*[:=]\s*\S+/gi,
    "[REDACTED]"
  );
  // Absolute home-like paths not already replaced
  sanitized = sanitized.replace(/\/home\/[^/\s]+/g, "<HOME>");
  sanitized = sanitized.replace(/file:\/\/\/home\/[^/\s]+/g, "file://<HOME>");
  // Generic temp dirs
  sanitized = sanitized.replace(/\/tmp\/[A-Za-z0-9._-]+/g, "<TMP>");
  sanitized = sanitized.replace(/\/var\/folders\/[^\s]+/g, "<TMP>");

  if (sanitized.length > maxLength) {
    return sanitized.slice(0, maxLength) + "\n...[TRUNCATED]";
  }
  return sanitized;
}

/**
 * OpenCode 1.17.18 resolves the project root as `process.env.PWD ?? process.cwd()`
 * and then resolves `--dir` relative to that root (see packages/opencode/src/cli/cmd/run.ts).
 * When PWD points at the parent repo but cwd is a temp project, `--dir .` operates
 * in the wrong tree. This helper documents that precedence for tests.
 */
export function resolveOpencodeProjectRoot(opts: {
  pwd?: string | null;
  cwd: string;
  dirArg: string;
}): string {
  const root = opts.pwd && opts.pwd.length > 0 ? resolve(opts.pwd) : resolve(opts.cwd);
  if (isAbsolute(opts.dirArg)) return resolve(opts.dirArg);
  return resolve(root, opts.dirArg);
}

/**
 * Env keys preserved when isolating host config/plugins.
 * Intentionally excludes NODE_OPTIONS, BUN_INSTALL, XDG_RUNTIME_DIR and other
 * host runtime pointers that are not credentials and can re-couple isolation to the host.
 */
export const PRESERVED_ENV_KEYS = [
  "OPENCODE_API_KEY",
  "OPENCODE_AUTH_CONTENT",
  "OPENCODE_SERVER_PASSWORD",
  "OPENCODE_SERVER_USERNAME",
  "OPENCODE_E2E_MODEL",
  "OPENCODE_BIN",
  "PATH",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "TMPDIR",
  "TMP",
  "TEMP",
] as const;

/** @deprecated use PRESERVED_ENV_KEYS — kept as alias for clarity in reviews */
const AUTH_ENV_ALLOWLIST = PRESERVED_ENV_KEYS;

export type ProjectRunEnvOptions = {
  /** Absolute isolated HOME (no host plugins/skills/agents). */
  isolateHome: string;
  /** Absolute isolated OpenCode config dir (empty of host plugins). */
  isolateConfigDir: string;
  /** Optional base env (defaults to process.env); only allowlisted + isolation keys are kept. */
  base?: NodeJS.ProcessEnv;
  /** Host home used only to seed auth credentials into the isolated data dir. */
  hostHome?: string;
  /** When true (default), copy host auth.json into isolated XDG data if present. */
  seedAuth?: boolean;
};

/**
 * Env for project-local behavioral OpenCode runs.
 * Forces PWD to the project root and redirects HOME/XDG/OPENCODE_CONFIG_DIR to
 * isolated temps so host global plugins cannot satisfy tool events.
 * Auth is preserved via allowlisted env vars and optional seeded auth.json only.
 */
export function buildProjectRunEnv(
  projectRoot: string,
  options?: ProjectRunEnvOptions | NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  // Backward-compatible: second arg was formerly a full base env object.
  const opts: ProjectRunEnvOptions =
    options && ("isolateHome" in options || "isolateConfigDir" in options)
      ? (options as ProjectRunEnvOptions)
      : {
          isolateHome: process.env.HOME || homedir(),
          isolateConfigDir: join(process.env.HOME || homedir(), ".config", "opencode"),
          base: options as NodeJS.ProcessEnv | undefined,
          seedAuth: false,
        };

  const abs = resolve(projectRoot);
  const base = opts.base || process.env;
  const isoHome = resolve(opts.isolateHome);
  const isoConfig = resolve(opts.isolateConfigDir);
  const isoData = join(isoHome, ".local", "share");
  const isoCache = join(isoHome, ".cache");

  mkdirSync(isoHome, { recursive: true });
  mkdirSync(isoConfig, { recursive: true });
  mkdirSync(isoData, { recursive: true });
  mkdirSync(isoCache, { recursive: true });
  mkdirSync(join(isoHome, ".config"), { recursive: true });

  if (opts.seedAuth !== false) {
    seedIsolatedAuth(isoHome, opts.hostHome || process.env.HOME || homedir());
  }

  const env: NodeJS.ProcessEnv = {};
  for (const key of AUTH_ENV_ALLOWLIST) {
    if (base[key] !== undefined) env[key] = base[key];
  }

  env.PWD = abs;
  env.HOME = isoHome;
  env.OPENCODE_TEST_HOME = isoHome;
  env.OPENCODE_CONFIG_DIR = isoConfig;
  env.XDG_CONFIG_HOME = join(isoHome, ".config");
  env.XDG_DATA_HOME = isoData;
  env.XDG_CACHE_HOME = isoCache;
  // Block host default plugins / external skills; project .opencode still loads.
  env.OPENCODE_DISABLE_DEFAULT_PLUGINS = "1";
  env.OPENCODE_DISABLE_EXTERNAL_SKILLS = "1";
  env.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS = "1";

  return env;
}

/**
 * Copy only provider auth credentials into the isolated data home.
 * Never copies plugins, skills, agents, or config. Never logs file contents.
 */
export function seedIsolatedAuth(isolateHome: string, hostHome: string): {
  seeded: boolean;
  source?: string;
  dest?: string;
} {
  const src = join(hostHome, ".local", "share", "opencode", "auth.json");
  const destDir = join(isolateHome, ".local", "share", "opencode");
  const dest = join(destDir, "auth.json");
  if (!existsSync(src) || !statSync(src).isFile()) {
    return { seeded: false };
  }
  mkdirSync(destDir, { recursive: true });
  writeFileSync(dest, readFileSync(src));
  try {
    // Keep credentials non-world-readable when possible
    accessSync(dest, constants.R_OK);
  } catch {}
  return { seeded: true, source: src, dest };
}

export function isPwdAlignedWithCwd(env: NodeJS.ProcessEnv | undefined, cwd: string): boolean {
  if (!env?.PWD) return false;
  return resolve(env.PWD) === resolve(cwd);
}

export function isConfigIsolated(env: NodeJS.ProcessEnv | undefined, isolateConfigDir: string): boolean {
  if (!env?.OPENCODE_CONFIG_DIR) return false;
  return resolve(env.OPENCODE_CONFIG_DIR) === resolve(isolateConfigDir);
}

/** Build `opencode run` args with absolute `--dir` (never bare `.`). */
export function buildOpencodeRunArgs(opts: {
  projectDir: string;
  model?: string | null;
  command?: string;
  prompt?: string;
  extra?: string[];
}): string[] {
  const absDir = resolve(opts.projectDir);
  const args: string[] = ["run", "--dir", absDir, "--format", "json", "--auto"];
  if (opts.model && typeof opts.model === "string" && opts.model.trim().length > 0) {
    args.push("--model", opts.model.trim());
  }
  if (opts.command) {
    args.push("--command", opts.command);
  }
  if (opts.prompt) {
    args.push(opts.prompt);
  }
  if (opts.extra?.length) {
    for (const item of opts.extra) {
      if (typeof item === "string") args.push(item);
    }
  }
  // Structural guarantee: never return non-string args
  return args.filter((a): a is string => typeof a === "string");
}

export function extractDirArg(args: string[]): string | undefined {
  const i = args.indexOf("--dir");
  if (i === -1 || i + 1 >= args.length) return undefined;
  const v = args[i + 1];
  return typeof v === "string" ? v : undefined;
}

/** Safe CLI arg formatting for reports — never calls methods on non-strings. */
export function formatCliArgsForReport(
  args: Array<string | null | undefined>,
  sanitizePath?: (s: string, max?: number) => string
): string {
  return args
    .map((a) => {
      if (typeof a !== "string") return "<missing>";
      if (a.startsWith("/") || a.startsWith("file:")) {
        return sanitizePath ? sanitizePath(a, 200) : a;
      }
      return a;
    })
    .join(" ");
}

/**
 * Classification strings must not embed raw stdout/stderr.
 * Only structured categories (and optional pre-sanitized reason) are allowed.
 */
export function formatClassification(
  prefix: string,
  categories: string[] = [],
  sanitizedReason?: string
): string {
  const cats = categories.filter((c) => typeof c === "string" && c.length > 0);
  const parts = [prefix];
  if (cats.length > 0) parts.push(`categories: ${cats.join(",")}`);
  if (sanitizedReason && sanitizedReason.trim()) {
    parts.push(sanitizedReason.trim());
  }
  return parts.join(" — ");
}

/**
 * Even when the process exits non-zero, parse JSON/JSONL and classify failure signals.
 * Never invent a cause: only report categories backed by observed text/events.
 * `summary` is category-only (no raw stdout/stderr/paths/secrets).
 * Callers that need human-readable detail must sanitize stdout/stderr separately.
 */
export function diagnoseOpencodeOutput(
  stdout: string,
  stderr: string
): {
  events: any[];
  categories: string[];
  summary: string;
  toolStatuses: Array<{ tool?: string; status?: string; error?: unknown }>;
} {
  const events = parseJsonEvents(stdout || "");
  // Textual heuristics use stderr + structured error messages only — never full stdout
  // skill bodies (which can mention "model"/"provider" and create false positives).
  const structuredErrorMessages: string[] = [];
  const categories = new Set<string>();
  const toolStatuses: Array<{ tool?: string; status?: string; error?: unknown }> = [];

  for (const e of events) {
    if (!e || typeof e !== "object") continue;
    if (e.type === "error" || e.error) {
      categories.add("opencode_error_event");
      const msg =
        (e.error && typeof e.error === "object" && (e.error.data?.message || e.error.message)) ||
        (typeof e.error === "string" ? e.error : "") ||
        "";
      if (msg) structuredErrorMessages.push(String(msg));
      if (/Unexpected server error|UnknownError/i.test(String(msg))) {
        categories.add("opencode_internal_error");
      }
    }
  }

  for (const n of normalizeAllToolEvents(events)) {
    // Never put tool error payloads into summary — only names/statuses.
    toolStatuses.push({
      tool: typeof n.tool === "string" ? n.tool : undefined,
      status: typeof n.status === "string" ? n.status : undefined,
    });
    if ((n.status || "").toLowerCase() === "error" || n.error) {
      categories.add("tool_error");
      if (n.tool && typeof n.tool === "string") categories.add(`tool_error:${n.tool}`);
      if (n.error) structuredErrorMessages.push(String(n.error));
    }
  }

  const textSurface = `${stderr || ""}\n${structuredErrorMessages.join("\n")}`;

  if (/command not found|unknown command|No such command|command .* not found/i.test(textSurface)) {
    categories.add("command_not_found");
  }
  if (
    /plugin/i.test(textSurface) &&
    /(?:fail|error|load|cannot|unable|missing)/i.test(textSurface)
  ) {
    categories.add("plugin_load_failure");
  }
  if (/tool not found|Unknown tool|unknown tool|no such tool/i.test(textSurface)) {
    categories.add("tool_not_found");
  }
  if (
    /(?:unauthoriz|authentication|api[_ -]?key|credential|provider.*(unavailable|error)|model.*(unavailable|not found|error)|rate.?limit)/i.test(
      textSurface
    )
  ) {
    categories.add("model_provider_failure");
  }
  if (/Unexpected server error|UnknownError/i.test(textSurface)) {
    categories.add("opencode_internal_error");
  }

  const cats = Array.from(categories);
  // Category-only summary — never embed raw stdout/stderr or error payloads.
  const summary =
    cats.length > 0
      ? cats.join(", ")
      : events.length > 0
        ? "no structured failure category"
        : "no stdout/stderr evidence";

  return { events, categories: cats, summary, toolStatuses };
}

export function runSafe(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  env?: NodeJS.ProcessEnv
): ProcessLike {
  const absCwd = resolve(cwd);
  // Always clone env and force PWD === absolute cwd so OpenCode's
  // `PWD ?? cwd` root resolution cannot diverge from the intended project.
  const merged: NodeJS.ProcessEnv = {
    ...(env || process.env),
    PWD: absCwd,
  };
  const result = spawnSync(cmd, args, {
    cwd: absCwd,
    shell: false,
    timeout: timeoutMs,
    encoding: "utf8",
    maxBuffer: 5 * 1024 * 1024,
    env: merged,
  });
  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    status: result.status,
    signal: result.signal,
    error: result.error,
  };
}

export function resolveBinary(): string | undefined {
  if (process.env.OPENCODE_BIN) {
    const candidate = process.env.OPENCODE_BIN;
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {}
    }
  }

  const persistedPath = join(homedir(), ".config", "opencode", "path");
  if (existsSync(persistedPath)) {
    try {
      const p = readFileSync(persistedPath, "utf8").trim();
      if (p && existsSync(p) && statSync(p).isFile()) {
        accessSync(p, constants.X_OK);
        return p;
      }
    } catch {}
  }

  const paths = process.env.PATH ? process.env.PATH.split(delimiter) : [];
  for (const p of paths) {
    if (!p) continue;
    const fullPath = join(p, "opencode");
    if (existsSync(fullPath) && statSync(fullPath).isFile()) {
      try {
        accessSync(fullPath, constants.X_OK);
        return fullPath;
      } catch {}
    }
  }

  const fallback = join(homedir(), ".local", "bin", "opencode");
  if (existsSync(fallback) && statSync(fallback).isFile()) {
    try {
      accessSync(fallback, constants.X_OK);
      return fallback;
    } catch {}
  }
  return undefined;
}

function hashBuffer(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

function collectFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  const st = statSync(dir);
  if (st.isFile()) {
    acc.push(dir);
    return acc;
  }
  if (!st.isDirectory()) return acc;
  for (const name of readdirSync(dir).sort()) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    collectFiles(join(dir, name), acc);
  }
  return acc;
}

export function computeSourceFingerprint(repositoryRoot: string): string {
  const h = createHash("sha256");
  for (const rel of SOURCE_FINGERPRINT_PATHS) {
    const abs = join(repositoryRoot, rel);
    if (!existsSync(abs)) {
      h.update(`missing:${rel}\n`);
      continue;
    }
    const files = collectFiles(abs).sort();
    for (const f of files) {
      h.update(relative(repositoryRoot, f));
      h.update("\0");
      h.update(readFileSync(f));
      h.update("\n");
    }
  }
  return h.digest("hex");
}

export function readGitHead(repositoryRoot: string): string {
  try {
    const r = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      shell: false,
    });
    return (r.stdout || "").trim() || "unknown";
  } catch {
    return "unknown";
  }
}

export type BundleCheck = {
  ok: boolean;
  reason?: string;
  head: string;
  sourceFingerprint: string;
  distHash?: string;
  stampPath: string;
};

/**
 * Ensure dist/index.js exists and matches the HEAD source fingerprint stamp.
 * When `rebuild` is true, runs `bun run build` and writes a new stamp.
 */
export function ensureDistBundle(
  repositoryRoot: string,
  opts: { rebuild?: boolean } = {}
): BundleCheck {
  const head = readGitHead(repositoryRoot);
  const sourceFingerprint = computeSourceFingerprint(repositoryRoot);
  const distPath = join(repositoryRoot, "dist", "index.js");
  const stampPath = join(repositoryRoot, "dist", DIST_STAMP_NAME);

  const rebuild = () => {
    const build = spawnSync("bun", ["run", "build"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      shell: false,
      timeout: 120000,
    });
    if (build.status !== 0) {
      return {
        ok: false,
        reason: `build failed with exit ${build.status}: ${sanitizeOutput(build.stderr || build.stdout || "", 200)}`,
        head,
        sourceFingerprint,
        stampPath,
      } satisfies BundleCheck;
    }
    if (!existsSync(distPath)) {
      return {
        ok: false,
        reason: "dist/index.js missing after build",
        head,
        sourceFingerprint,
        stampPath,
      } satisfies BundleCheck;
    }
    const distHash = hashBuffer(readFileSync(distPath));
    const stamp = {
      head,
      sourceFingerprint,
      distHash,
      builtAt: new Date().toISOString(),
    };
    mkdirSync(join(repositoryRoot, "dist"), { recursive: true });
    writeFileSync(stampPath, JSON.stringify(stamp, null, 2) + "\n");
    return {
      ok: true,
      head,
      sourceFingerprint,
      distHash,
      stampPath,
    } satisfies BundleCheck;
  };

  if (opts.rebuild) return rebuild();

  if (!existsSync(distPath)) {
    return {
      ok: false,
      reason: "dist/index.js missing — run build before e2e or use package e2e:opencode script",
      head,
      sourceFingerprint,
      stampPath,
    };
  }

  const distHash = hashBuffer(readFileSync(distPath));
  if (!existsSync(stampPath)) {
    return {
      ok: false,
      reason: "dist build stamp missing — bundle relationship to HEAD is unverified",
      head,
      sourceFingerprint,
      distHash,
      stampPath,
    };
  }

  try {
    const stamp = JSON.parse(readFileSync(stampPath, "utf8"));
    if (stamp.sourceFingerprint !== sourceFingerprint) {
      return {
        ok: false,
        reason: "dist stamp source fingerprint mismatch — bundle is stale relative to sources",
        head,
        sourceFingerprint,
        distHash,
        stampPath,
      };
    }
    if (stamp.distHash && stamp.distHash !== distHash) {
      return {
        ok: false,
        reason: "dist/index.js hash does not match stamp — bundle was modified after build",
        head,
        sourceFingerprint,
        distHash,
        stampPath,
      };
    }
    if (stamp.head && stamp.head !== head && head !== "unknown") {
      return {
        ok: false,
        reason: `dist stamp HEAD ${stamp.head} differs from current HEAD ${head}`,
        head,
        sourceFingerprint,
        distHash,
        stampPath,
      };
    }
    return { ok: true, head, sourceFingerprint, distHash, stampPath };
  } catch {
    return {
      ok: false,
      reason: "dist build stamp unreadable",
      head,
      sourceFingerprint,
      distHash,
      stampPath,
    };
  }
}

/** Structured categories that force FAIL for init even when process exit is 0. */
export function hasStructuredInitFailure(categories: string[]): boolean {
  return categories.some(
    (c) =>
      c === "opencode_error_event" ||
      c === "opencode_internal_error" ||
      c.startsWith("tool_error")
  );
}

export function classifyInitPhase(params: {
  hasAuthAndModel: boolean;
  authBlockedReason?: string;
  result?: ProcessLike;
  evaluation?: InitEval;
  /** Structured diagnosis categories (tool_error, opencode_error_event, …). */
  structuredFailureCategories?: string[];
}): { classification: string; passed: boolean; outcome: Outcome } {
  if (!params.hasAuthAndModel) {
    // Reason must already be non-sensitive; callers sanitize before reporting.
    return {
      classification: formatClassification("BANCA_INIT_BLOCKED — provider authentication or model unavailable", [], params.authBlockedReason || "no model/auth"),
      passed: false,
      outcome: "BLOCKED",
    };
  }

  const result = params.result;
  if (!result) {
    return {
      classification: formatClassification("BANCA_INIT_FAILED — no process result"),
      passed: false,
      outcome: "FAIL",
    };
  }

  if (isTimedOut(result)) {
    return {
      classification: formatClassification("BANCA_INIT_FAILED — timeout"),
      passed: false,
      outcome: "FAIL",
    };
  }

  const diagFromResult =
    params.structuredFailureCategories ||
    diagnoseOpencodeOutput(result.stdout || "", result.stderr || "").categories;

  if (result.status !== 0) {
    return {
      classification: formatClassification(
        `BANCA_INIT_FAILED — exit code ${result.status}`,
        diagFromResult
      ),
      passed: false,
      outcome: "FAIL",
    };
  }

  // Structured session/tool errors force FAIL even when process exit is 0.
  if (hasStructuredInitFailure(diagFromResult)) {
    return {
      classification: formatClassification(
        "BANCA_INIT_FAILED — structured error events with exit 0",
        diagFromResult.filter(
          (c) =>
            c === "opencode_error_event" ||
            c === "opencode_internal_error" ||
            c.startsWith("tool_error")
        )
      ),
      passed: false,
      outcome: "FAIL",
    };
  }

  const e = params.evaluation;
  if (!e) {
    return {
      classification: formatClassification(
        "BANCA_INIT_FAILED — exact implementation reason",
        diagFromResult
      ),
      passed: false,
      outcome: "FAIL",
    };
  }

  const perfectInit =
    e.foundTool &&
    e.foundSuccess &&
    e.hasProjectJson &&
    e.hasStateJson &&
    e.exactAgents &&
    e.exactSkills &&
    e.skillMdCount === 8;

  if (perfectInit) {
    return {
      classification: "BANCA_INIT_PASSED",
      passed: true,
      outcome: "PASS",
    };
  }

  const missing: string[] = [];
  if (!e.foundTool) missing.push("banca_init_call_missing");
  if (!e.foundSuccess) missing.push("banca_init_success_missing");
  if (!e.hasProjectJson) missing.push("project_json_missing");
  if (!e.hasStateJson) missing.push("state_json_missing");
  if (!e.exactAgents) missing.push("agents_inventory_incomplete");
  if (!e.exactSkills || e.skillMdCount !== 8) missing.push("skills_inventory_incomplete");

  return {
    classification: formatClassification(
      "BANCA_INIT_FAILED — exact implementation reason",
      missing
    ),
    passed: false,
    outcome: "FAIL",
  };
}

export function classifyProtocolPhase(params: {
  hasAuthAndModel: boolean;
  initPassed: boolean;
  authBlockedReason?: string;
  result?: ProcessLike;
  evaluation?: ProtocolEval;
  /** Structured diagnosis categories from stdout/stderr (tool_error, opencode_error_event, …). */
  structuredFailureCategories?: string[];
}): { classification: string; passed: boolean; outcome: Outcome } {
  if (!params.hasAuthAndModel) {
    return {
      classification: formatClassification(
        "MODEL_PROTOCOL_BLOCKED — provider authentication or model unavailable",
        [],
        params.authBlockedReason || "no model/auth"
      ),
      passed: false,
      outcome: "BLOCKED",
    };
  }

  if (!params.initPassed) {
    return {
      classification: formatClassification(
        "MODEL_PROTOCOL_FAILED — initialization prerequisite not met"
      ),
      passed: false,
      outcome: "FAIL",
    };
  }

  const result = params.result;
  if (!result) {
    return {
      classification: formatClassification("MODEL_PROTOCOL_FAILED — no process result"),
      passed: false,
      outcome: "FAIL",
    };
  }

  if (isTimedOut(result)) {
    return {
      classification: formatClassification("MODEL_PROTOCOL_FAILED — timeout"),
      passed: false,
      outcome: "FAIL",
    };
  }

  const diagFromResult =
    params.structuredFailureCategories ||
    diagnoseOpencodeOutput(result.stdout || "", result.stderr || "").categories;

  if (result.status !== 0) {
    return {
      classification: formatClassification(
        `MODEL_PROTOCOL_FAILED — exit code ${result.status}`,
        diagFromResult
      ),
      passed: false,
      outcome: "FAIL",
    };
  }

  // Structured session/tool errors force FAIL even when process exit is 0.
  if (hasStructuredProtocolFailure(diagFromResult)) {
    return {
      classification: formatClassification(
        "MODEL_PROTOCOL_FAILED — structured error events with exit 0",
        diagFromResult.filter(
          (c) =>
            c === "opencode_error_event" ||
            c === "opencode_internal_error" ||
            c.startsWith("tool_error")
        )
      ),
      passed: false,
      outcome: "FAIL",
    };
  }

  const e = params.evaluation;
  if (!e) {
    return {
      classification: formatClassification(
        "MODEL_PROTOCOL_FAILED — agent/tool/permission/protocol",
        diagFromResult
      ),
      passed: false,
      outcome: "FAIL",
    };
  }

  if (e.claimedSubagentWithoutEvidence) {
    return {
      classification: formatClassification(
        "MODEL_PROTOCOL_FAILED — cannot attribute execution to banca-auditor subagent"
      ),
      passed: false,
      outcome: "FAIL",
    };
  }

  const perfectProto =
    e.skillArgsCorrect &&
    e.skillEvidence &&
    e.skillSucceeded &&
    e.contextCalled &&
    e.auditarCalled &&
    e.correctOrder &&
    e.hashesMatch;

  if (perfectProto) {
    return {
      classification: "MODEL_PROTOCOL_PASSED",
      passed: true,
      outcome: "PASS",
    };
  }

  const missing: string[] = [];
  if (!e.skillSucceeded) missing.push("skill_not_succeeded");
  if (!e.skillArgsCorrect) missing.push("skill_args_incorrect");
  if (!e.skillEvidence) missing.push("skill_evidence_missing");
  if (!e.contextCalled) missing.push("banca_context_not_succeeded");
  if (!e.auditarCalled) missing.push("banca_auditar_not_succeeded");
  if (!e.correctOrder) missing.push("tool_order_incorrect");
  if (!e.hashesMatch) missing.push("manuscript_modified");

  return {
    classification: formatClassification(
      "MODEL_PROTOCOL_FAILED — agent/tool/permission/protocol",
      missing
    ),
    passed: false,
    outcome: "FAIL",
  };
}

export function decideFinalExitCode(phases: {
  discoveryAgents: Outcome;
  discoverySkills: Outcome;
  init: Outcome;
  protocol: Outcome;
  bundle?: Outcome;
}): { finalOutcome: Outcome; exitCode: number } {
  const finalOutcome = combineOutcomes(
    phases.bundle || "PASS",
    phases.discoveryAgents,
    phases.discoverySkills,
    phases.init,
    phases.protocol
  );
  return { finalOutcome, exitCode: outcomeToExitCode(finalOutcome) };
}

function discoveryOutcome(passed: boolean): Outcome {
  return passed ? "PASS" : "FAIL";
}

function buildIsolatedDiscoveryEnv(
  isoHome: string,
  isoConfig: string,
  projectRoot?: string
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: isoHome,
    OPENCODE_TEST_HOME: isoHome,
    OPENCODE_CONFIG_DIR: isoConfig,
    XDG_CONFIG_HOME: join(isoHome, ".config"),
    XDG_DATA_HOME: join(isoHome, ".local", "share"),
    XDG_CACHE_HOME: join(isoHome, ".cache"),
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
    OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
    OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1",
    // Do not set OPENCODE_PURE — may alter project loading; isolation of HOME/config is enough.
  };
  if (projectRoot) {
    env.PWD = resolve(projectRoot);
  }
  return env;
}

async function run() {
  const repositoryRoot = process.cwd();
  const report: string[] = [];

  const parseTo = (val: string | undefined, def: number, max: number) => {
    if (!val) return def;
    const n = parseInt(val, 10);
    if (isNaN(n) || n <= 0) return def;
    return Math.min(n, max);
  };
  const TIMEOUT_DIAGNOSTICS = parseTo(process.env.TIMEOUT_DIAGNOSTICS, 45000, 120000);
  const TIMEOUT_DISCOVERY = parseTo(process.env.TIMEOUT_DISCOVERY, 30000, 120000);
  const TIMEOUT_INIT = parseTo(process.env.TIMEOUT_INIT, 90000, 300000);
  const TIMEOUT_PROTOCOL = parseTo(process.env.TIMEOUT_PROTOCOL, 120000, 600000);

  const bin = resolveBinary();

  const date = new Date().toISOString();
  let branch = "unknown";
  let sha = "unknown";
  let nodeVersion = process.version;
  let bunVersion = "unknown";
  try {
    branch = spawnSync("git", ["branch", "--show-current"], { encoding: "utf8" }).stdout?.trim() || "unknown";
    sha = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout?.trim() || "unknown";
    bunVersion = spawnSync("bun", ["--version"], { encoding: "utf8" }).stdout?.trim() || "unknown";
  } catch {}

  const pathSanitize = createPathSanitizer({
    home: homedir(),
    repoRoot: repositoryRoot,
    tempRoots: [tmpdir()],
  });
  const S = (text: string, max = 1000) => sanitizeOutput(text, max, pathSanitize);

  report.push("## Revision\n");
  report.push(`Branch: ${branch}`);
  report.push(`Tested SHA: ${sha}`);
  report.push(`Date: ${date}`);
  report.push(`Node: ${nodeVersion}`);
  report.push(`Bun: ${bunVersion}`);
  report.push(`OpenCode binary: ${bin ? S(bin, 200) : "NOT FOUND"}`);

  // Bundle must match HEAD/sources
  let bundleOutcome: Outcome = "PASS";
  let bundle = ensureDistBundle(repositoryRoot, { rebuild: process.env.E2E_SKIP_REBUILD !== "1" });
  if (!bundle.ok && process.env.E2E_SKIP_REBUILD === "1") {
    bundleOutcome = "FAIL";
  } else if (!bundle.ok) {
    // rebuild already attempted inside ensure when rebuild:true
    bundleOutcome = "FAIL";
  }
  report.push(
    `Bundle: head=${bundle.head} sourceFingerprint=${bundle.sourceFingerprint.slice(0, 16)}… distHash=${(bundle.distHash || "none").slice(0, 16)}… ok=${bundle.ok}`
  );
  if (!bundle.ok) {
    report.push(`Bundle classification: FAIL — ${bundle.reason}`);
    bundleOutcome = "FAIL";
  } else {
    report.push(`Bundle classification: PASS — dist linked to HEAD via fingerprint stamp`);
  }

  if (!bin) {
    report.push(`OpenCode version: NOT FOUND`);
    report.push(`Model: NOT FOUND`);
    report.push(`Plugin loading mechanism: NOT FOUND`);
    report.push("\n## Issue #21\n");
    report.push("Five agents listed: BLOCKED");
    report.push("Eight skills discovered: BLOCKED");
    report.push("banca-avaliacao loaded: BLOCKED");
    report.push("Real protocol executed: BLOCKED");
    report.push("Portable initialization: BLOCKED");
    report.push("\n## Final assessment\n\nBLOCKED");
    console.log(report.join("\n"));
    process.exit(bundleOutcome === "FAIL" ? 1 : 2);
  }

  let opencodeVersion = "unknown";
  try {
    opencodeVersion = (runSafe(bin, ["--version"], repositoryRoot, TIMEOUT_DIAGNOSTICS).stdout || "").trim();
  } catch {}
  report.push(`OpenCode version: ${opencodeVersion}`);

  let opencodeHasRunCmd = false;
  try {
    const helpRes = runSafe(bin, ["--help"], repositoryRoot, TIMEOUT_DIAGNOSTICS);
    const helpOut = `${helpRes.stdout || ""}\n${helpRes.stderr || ""}`;
    if (helpOut.includes("run [message..]")) opencodeHasRunCmd = true;
  } catch {}
  if (!opencodeHasRunCmd) {
    try {
      const runHelp = runSafe(bin, ["run", "--help"], repositoryRoot, TIMEOUT_DIAGNOSTICS);
      const runHelpOut = `${runHelp.stdout || ""}\n${runHelp.stderr || ""}`;
      if (runHelpOut.includes("--format") || runHelpOut.includes("--command")) {
        opencodeHasRunCmd = true;
      }
    } catch {}
  }
  report.push(`OpenCode run subcommand: ${opencodeHasRunCmd ? "available" : "not detected"}`);

  let model = process.env.OPENCODE_E2E_MODEL;
  if (!model) {
    try {
      const modelsRes = runSafe(
        bin,
        ["models", "opencode", "--refresh", "--verbose"],
        repositoryRoot,
        TIMEOUT_DIAGNOSTICS
      );
      const modelsRaw = `${modelsRes.stdout || ""}\n${modelsRes.stderr || ""}`;
      if (modelsRaw.includes("opencode/mimo-v2.5-free")) {
        model = "opencode/mimo-v2.5-free";
      }
    } catch {}
  }
  report.push(`Model: ${model || "NOT FOUND"}`);

  let hasAuthAndModel = false;
  let authBlockedReason = "";
  if (model) {
    const testCmdArgs = ["run", "--model", model, "--format", "json", "hi"];
    const testRes = runSafe(bin, testCmdArgs, repositoryRoot, TIMEOUT_DIAGNOSTICS);
    const combined = `${testRes.stdout || ""}\n${testRes.stderr || ""}`;
    const looksLikeHelp =
      combined.includes("Commands:") && combined.includes("opencode completion");
    const hasJsonEvent =
      combined.includes('"type"') ||
      combined.includes("step_start") ||
      combined.includes("step-start") ||
      combined.includes("tool_use");
    if (testRes.status === 0 && !looksLikeHelp && hasJsonEvent) {
      hasAuthAndModel = true;
    } else {
      authBlockedReason = S(testRes.stderr || testRes.stdout || "auth probe failed", 200);
    }
  } else {
    authBlockedReason = "no model candidate selected";
  }

  let discoveryAgentsOutcome: Outcome = "FAIL";
  let discoverySkillsOutcome: Outcome = "FAIL";
  let initOutcome: Outcome = "FAIL";
  let protocolOutcome: Outcome = "FAIL";

  const tmpProjectDisc = mkdtempSync(join(tmpdir(), "e2e-opencode-disc-"));
  const tmpProjectInit = mkdtempSync(join(tmpdir(), "e2e-opencode-init-"));
  const isoHome = mkdtempSync(join(tmpdir(), "e2e-opencode-home-"));
  const isoConfig = mkdtempSync(join(tmpdir(), "e2e-opencode-config-"));
  const isoBehaviorHome = mkdtempSync(join(tmpdir(), "e2e-opencode-beh-home-"));
  const isoBehaviorConfig = mkdtempSync(join(tmpdir(), "e2e-opencode-beh-config-"));

  const pathSanitizeFull = createPathSanitizer({
    home: homedir(),
    repoRoot: repositoryRoot,
    tempRoots: [
      tmpdir(),
      tmpProjectDisc,
      tmpProjectInit,
      isoHome,
      isoConfig,
      isoBehaviorHome,
      isoBehaviorConfig,
    ],
  });
  const SF = (text: string, max = 1000) => sanitizeOutput(text, max, pathSanitizeFull);

  try {
    spawnSync("git", ["init"], { cwd: tmpProjectDisc });
    const { installAssets } = await import("../src/lib/install_assets.ts");
    installAssets(tmpProjectDisc, true, join(repositoryRoot, "assets"));

    spawnSync("git", ["init"], { cwd: tmpProjectInit });
    writeFileSync(
      join(tmpProjectInit, "main.tex"),
      "\\documentclass{article}\n\\begin{document}\n\\title{Synthetic}\n\\maketitle\n\\section{Intro}\nThis is a synthetic document.\n\\cite{test2024}\n\\end{document}\n"
    );
    writeFileSync(
      join(tmpProjectInit, "referencias.bib"),
      "@article{test2024,\n  title={Synthetic Paper},\n  author={Author, A.},\n  year={2024}\n}\n"
    );

    function hashFile(p: string) {
      return createHash("sha256").update(readFileSync(p)).digest("hex");
    }
    const preHashTex = hashFile(join(tmpProjectInit, "main.tex"));
    const preHashBib = hashFile(join(tmpProjectInit, "referencias.bib"));

    const commandsDir = join(tmpProjectInit, ".opencode", "commands");
    mkdirSync(commandsDir, { recursive: true });
    const initCmdSrc = join(repositoryRoot, "assets", "opencode", "commands", "banca-init.md");
    if (existsSync(initCmdSrc)) {
      writeFileSync(join(commandsDir, "banca-init.md"), readFileSync(initCmdSrc));
    } else {
      report.push("ERROR: assets/opencode/commands/banca-init.md not found in repo.");
      discoveryAgentsOutcome = "FAIL";
    }

    const pluginsDir = join(tmpProjectInit, ".opencode", "plugins");
    mkdirSync(pluginsDir, { recursive: true });
    const builtPluginPath = join(repositoryRoot, "dist", "index.js");
    const builtPluginUrl = pathToFileURL(builtPluginPath).href;

    writeFileSync(
      join(pluginsDir, "openbanca-e2e.ts"),
      `export { default } from ${JSON.stringify(builtPluginUrl)};\n`
    );

    report.push(
      `Plugin loading mechanism:\nProject-local .opencode/plugins/openbanca-e2e.ts wrapper importing ${SF(builtPluginUrl, 300)}`
    );

    const discEnv = buildIsolatedDiscoveryEnv(isoHome, isoConfig, tmpProjectDisc);

    report.push("\n## Agent discovery\n");
    report.push(`Isolation: OPENCODE_CONFIG_DIR=<TMP> HOME=<TMP> PWD=project (host global config excluded)`);
    let agentClass = "";
    let agentPassed = false;

    const agentResult = runSafe(bin, ["agent", "list"], tmpProjectDisc, TIMEOUT_DISCOVERY, discEnv);
    if (isTimedOut(agentResult)) {
      agentClass = "NO_MODEL_DISCOVERY_FAILED — timeout";
    } else if (agentResult.status !== 0) {
      agentClass = `NO_MODEL_DISCOVERY_FAILED — exit code ${agentResult.status}`;
    } else {
      agentClass = verifyAgents(agentResult.stdout || "", tmpProjectDisc);
      if (agentClass === "NO_MODEL_DISCOVERY_PASSED") agentPassed = true;
    }

    report.push(`Command: opencode agent list`);
    report.push(`Exit code: ${agentResult.status}`);
    report.push(`Agents observed stdout:\n${SF(agentResult.stdout || "", 500)}`);
    if (agentResult.stderr) report.push(`Agents observed stderr:\n${SF(agentResult.stderr, 500)}`);
    report.push(`Classification: ${agentClass}`);
    discoveryAgentsOutcome = discoveryOutcome(agentPassed);

    report.push("\n## Skill discovery\n");
    let skillClass = "";
    let skillPassed = false;

    const skillResult = runSafe(bin, ["debug", "skill"], tmpProjectDisc, TIMEOUT_DISCOVERY, discEnv);
    if (isTimedOut(skillResult)) {
      skillClass = "NO_MODEL_DISCOVERY_FAILED — timeout";
    } else if (skillResult.status !== 0) {
      skillClass = `NO_MODEL_DISCOVERY_FAILED — exit code ${skillResult.status}`;
    } else {
      skillClass = verifySkills(skillResult.stdout || "", tmpProjectDisc);
      if (skillClass === "NO_MODEL_DISCOVERY_PASSED") skillPassed = true;
    }

    report.push(`Command: opencode debug skill`);
    report.push(`Exit code: ${skillResult.status}`);
    report.push(`Skills observed stdout:\n${SF(skillResult.stdout || "", 500)}`);
    if (skillResult.stderr) report.push(`Skills observed stderr:\n${SF(skillResult.stderr, 500)}`);
    report.push(`Classification: ${skillClass}`);
    discoverySkillsOutcome = discoveryOutcome(skillPassed);

    report.push("\n## Initialization\n");
    let initPassed = false;

    // Absolute project path + isolated HOME/config so host global plugins cannot satisfy tools.
    const initProjectAbs = resolve(tmpProjectInit);
    // seedAuth once inside buildProjectRunEnv only (no duplicate copy).
    const projectRunEnv = buildProjectRunEnv(initProjectAbs, {
      isolateHome: isoBehaviorHome,
      isolateConfigDir: isoBehaviorConfig,
      hostHome: process.env.HOME || homedir(),
      seedAuth: true,
    });
    const authSeed = {
      seeded: existsSync(join(isoBehaviorHome, ".local", "share", "opencode", "auth.json")),
    };

    // Never build model-dependent CLI args with a non-string model (avoids TypeError on report).
    const initCmdArgs = buildOpencodeRunArgs({
      projectDir: initProjectAbs,
      model: typeof model === "string" && model.length > 0 ? model : undefined,
      command: "banca-init",
    });

    let initEval: InitEval | undefined;
    let initResult: ProcessLike | undefined;

    report.push(`cwd: ${SF(initProjectAbs, 300)}`);
    report.push(`PWD: ${SF(projectRunEnv.PWD || "", 300)}`);
    report.push(`HOME(isolated): ${SF(projectRunEnv.HOME || "", 300)}`);
    report.push(`OPENCODE_CONFIG_DIR(isolated): ${SF(projectRunEnv.OPENCODE_CONFIG_DIR || "", 300)}`);
    report.push(`--dir: ${SF(extractDirArg(initCmdArgs) || "", 300)}`);
    report.push(
      `PWD_aligned: ${isPwdAlignedWithCwd(projectRunEnv, initProjectAbs) ? "true" : "false"}`
    );
    report.push(
      `CONFIG_isolated: ${isConfigIsolated(projectRunEnv, isoBehaviorConfig) ? "true" : "false"}`
    );
    report.push(`Auth seed: ${authSeed.seeded ? "copied-to-isolated-data-home" : "not-present"}`);
    report.push(
      `Plugin provenance: project-local .opencode/plugins/openbanca-e2e.ts → stamped dist (host plugins excluded)`
    );
    report.push(
      `OpenCode root resolution check: ${SF(
        resolveOpencodeProjectRoot({
          pwd: projectRunEnv.PWD,
          cwd: initProjectAbs,
          dirArg: extractDirArg(initCmdArgs) || initProjectAbs,
        }),
        300
      )}`
    );

    let initStructuredCategories: string[] | undefined;

    if (hasAuthAndModel && bundleOutcome === "PASS" && typeof model === "string") {
      initResult = runSafe(bin, initCmdArgs, initProjectAbs, TIMEOUT_INIT, projectRunEnv);

      // Always parse JSON/JSONL — including non-zero exits — for diagnosis.
      const initEvents = parseJsonEvents(initResult.stdout || "");
      const diagnosis = diagnoseOpencodeOutput(initResult.stdout || "", initResult.stderr || "");
      initStructuredCategories = diagnosis.categories;
      const tools = normalizeAllToolEvents(initEvents).filter((t) => t.tool === "banca_init");
      report.push(
        `Normalized banca_init events: ${tools.length} (statuses: ${tools.map((t) => t.status || "n/a").join(", ") || "none"})`
      );
      // Always surface structured categories (tool_error / opencode_error_event), even if exit is 0.
      // Textual false-positives are already avoided by diagnoseOpencodeOutput (stderr/error-only heuristics).
      if (diagnosis.categories.length > 0) {
        report.push(`Diagnosis categories: ${diagnosis.categories.join(", ")}`);
        report.push(`Diagnosis summary: ${SF(diagnosis.summary, 400)}`);
      } else {
        report.push(`Diagnosis categories: none`);
        report.push(`Diagnosis summary: no structured failure category`);
      }

      // Artifacts are only meaningful after a completed banca_init; still measure for evidence.
      const hasProjectJson = existsSync(join(tmpProjectInit, ".banca", "project.json"));
      const hasStateJson = existsSync(join(tmpProjectInit, ".banca", "state.json"));
      report.push(
        `Artifacts before evaluation: project.json=${hasProjectJson} state.json=${hasStateJson} (must follow completed banca_init, not pre-seeded)`
      );

      if (!isTimedOut(initResult) && initResult.status === 0) {
        const { foundTool, foundSuccess } = verifyInitEvents(initEvents);

        const skillsDir = join(tmpProjectInit, ".opencode", "skills");
        let skillMdCount = 0;
        let exactSkills = false;
        if (existsSync(skillsDir)) {
          const folders = readdirSync(skillsDir).filter(
            (f) => !f.startsWith(".") && statSync(join(skillsDir, f)).isDirectory()
          );
          exactSkills = folders.length === 8 && SKILLS_REQUIRED.every((s) => folders.includes(s));
          for (const f of folders) {
            if (existsSync(join(skillsDir, f, "SKILL.md"))) skillMdCount++;
          }
        }

        const agentsDir = join(tmpProjectInit, ".opencode", "agents");
        let exactAgents = false;
        if (existsSync(agentsDir)) {
          const files = readdirSync(agentsDir).filter(
            (f) => !f.startsWith(".") && statSync(join(agentsDir, f)).isFile()
          );
          const agentNames = files.map((f) => f.replace(".md", ""));
          exactAgents = files.length === 5 && AGENTS_REQUIRED.every((a) => agentNames.includes(a));
        }

        // Presence of files alone is insufficient: require correlated tool success.
        initEval = {
          foundTool,
          foundSuccess,
          hasProjectJson: foundSuccess && hasProjectJson,
          hasStateJson: foundSuccess && hasStateJson,
          exactAgents: foundSuccess && exactAgents,
          exactSkills: foundSuccess && exactSkills,
          skillMdCount: foundSuccess ? skillMdCount : 0,
        };
      }

      report.push(`Command: opencode ${formatCliArgsForReport(initCmdArgs, SF)}`);
      report.push(`Exit code: ${initResult.status}`);
      report.push(`stdout:\n${SF(initResult.stdout || "", 500)}`);
      if (initResult.stderr) report.push(`stderr:\n${SF(initResult.stderr, 500)}`);
    } else {
      report.push(`Command: opencode ${formatCliArgsForReport(initCmdArgs, SF)}`);
      if (bundleOutcome === "FAIL" && hasAuthAndModel) {
        initResult = { status: 1, stdout: "", stderr: "bundle not ready", signal: null, error: null };
      }
    }

    const initDecision = classifyInitPhase({
      hasAuthAndModel: hasAuthAndModel && bundleOutcome === "PASS",
      authBlockedReason:
        bundleOutcome === "FAIL"
          ? "bundle missing/stale"
          : SF(authBlockedReason || "no model/auth", 200),
      result: initResult,
      evaluation: initEval,
      // Structured errors force FAIL even when exit code is 0.
      structuredFailureCategories: initStructuredCategories,
    });
    // If auth ok but bundle failed, force FAIL not BLOCKED
    if (bundleOutcome === "FAIL" && hasAuthAndModel) {
      initPassed = false;
      initOutcome = "FAIL";
      report.push(`Classification: ${SF("BANCA_INIT_FAILED — bundle missing/stale", 300)}`);
    } else {
      initPassed = initDecision.passed;
      initOutcome = initDecision.outcome;
      report.push(`Classification: ${SF(initDecision.classification, 500)}`);
    }

    report.push("\n## Native skill protocol\n");
    // banca-auditor is mode:subagent — do NOT pass --agent banca-auditor (CLI falls back).
    // Prove protocol via native tool events from the primary agent.
    const agentAttr = detectAgentAttribution({
      requestedAgent: null,
      stderr: "",
      stdout: "",
    });
    report.push(`Agent requested: (none — primary default)`);
    report.push(`Agent observed: ${agentAttr.observed}`);
    report.push(`Agent attribution: ${agentAttr.reason}`);
    report.push(`Note: banca-auditor is mode:subagent and cannot be selected via opencode run --agent`);

    let protocolPassed = false;
    let protocolResult: ProcessLike | undefined;
    let protocolEval: ProtocolEval | undefined;

    const prompt =
      "Load banca-avaliacao using the native skill tool with name banca-avaliacao. Follow its protocol on this synthetic project. Call banca_context before banca_auditar. Do not modify manuscript source files. Do not claim to be banca-auditor unless a child subagent session is actually created.";
    // Same absolute dir + isolated env as init (no host global plugins).
    const protoArgs = buildOpencodeRunArgs({
      projectDir: initProjectAbs,
      model: typeof model === "string" && model.length > 0 ? model : undefined,
      prompt,
    });
    report.push(`Protocol cwd/PWD/--dir: ${SF(initProjectAbs, 300)} (same isolation as init)`);
    report.push(
      `Protocol PWD_aligned: ${isPwdAlignedWithCwd(projectRunEnv, initProjectAbs) ? "true" : "false"}`
    );
    report.push(
      `Protocol CONFIG_isolated: ${isConfigIsolated(projectRunEnv, isoBehaviorConfig) ? "true" : "false"}`
    );

    let protocolStructuredCategories: string[] | undefined;

    if (hasAuthAndModel && initPassed && bundleOutcome === "PASS" && typeof model === "string") {
      protocolResult = runSafe(bin, protoArgs, initProjectAbs, TIMEOUT_PROTOCOL, projectRunEnv);

      const attrAfter = detectAgentAttribution({
        requestedAgent: null,
        stderr: protocolResult.stderr || "",
        stdout: protocolResult.stdout || "",
      });
      report.push(`Session attribution after run: ${attrAfter.observed} (${attrAfter.reason})`);

      const protoEvents = parseJsonEvents(protocolResult.stdout || "");
      const protoDiag = diagnoseOpencodeOutput(
        protocolResult.stdout || "",
        protocolResult.stderr || ""
      );
      protocolStructuredCategories = protoDiag.categories;
      const tools = normalizeAllToolEvents(protoEvents).filter((t) =>
        ["skill", "banca_context", "banca_auditar"].includes(t.tool || "")
      );
      report.push(
        `Normalized protocol tools: ${tools.map((t) => `${t.tool}:${t.status || "?"}`).join(" → ") || "none"}`
      );
      // Always report structured failure categories when present (including exit 0 + tool_error).
      if (protoDiag.categories.length > 0) {
        report.push(`Protocol diagnosis: ${SF(protoDiag.summary, 400)}`);
      } else {
        report.push(`Protocol diagnosis: no structured failure category`);
      }

      if (!isTimedOut(protocolResult)) {
        // Evaluate tools even when status is non-zero for evidence; classification uses both.
        const {
          skillArgsCorrect,
          skillEvidence,
          skillSucceeded,
          contextCalled,
          auditarCalled,
          correctOrder,
        } = verifyProtocolEvents(protoEvents);

        const postHashTex = hashFile(join(tmpProjectInit, "main.tex"));
        const postHashBib = hashFile(join(tmpProjectInit, "referencias.bib"));
        const hashesMatch = preHashTex === postHashTex && preHashBib === postHashBib;

        protocolEval = {
          skillArgsCorrect,
          skillEvidence,
          skillSucceeded,
          contextCalled,
          auditarCalled,
          correctOrder,
          hashesMatch,
          claimedSubagentWithoutEvidence: false,
        };
      }

      report.push(`Command: opencode ${formatCliArgsForReport(protoArgs, SF)}`);
      report.push(`Exit code: ${protocolResult.status}`);
      report.push(`stdout:\n${SF(protocolResult.stdout || "", 500)}`);
      if (protocolResult.stderr) report.push(`stderr:\n${SF(protocolResult.stderr, 500)}`);
    } else {
      report.push(`Command: opencode ${formatCliArgsForReport(protoArgs, SF)}`);
    }

    const protocolDecision = classifyProtocolPhase({
      hasAuthAndModel: hasAuthAndModel && bundleOutcome === "PASS",
      initPassed,
      authBlockedReason:
        bundleOutcome === "FAIL"
          ? "bundle missing/stale"
          : SF(authBlockedReason || "no model/auth", 200),
      result: protocolResult,
      evaluation: protocolEval,
      // Structured errors force FAIL even when exit code is 0 (effective, not a no-op).
      structuredFailureCategories: protocolStructuredCategories,
    });
    protocolPassed = protocolDecision.passed;
    protocolOutcome = protocolDecision.outcome;
    report.push(`Classification: ${SF(protocolDecision.classification, 500)}`);

    report.push("\n## Issue #21\n");

    function p(passed: boolean, blocked: boolean) {
      if (blocked) return "BLOCKED";
      return passed ? "PASS" : "FAIL";
    }

    const modelDependentBlocked = !hasAuthAndModel && bundleOutcome === "PASS";

    report.push(`Five agents listed: ${p(agentPassed, false)}`);
    report.push(`Eight skills discovered: ${p(skillPassed, false)}`);
    report.push(`banca-avaliacao loaded: ${p(protocolPassed, modelDependentBlocked)}`);
    report.push(`Real protocol executed: ${p(protocolPassed, modelDependentBlocked)}`);
    report.push(
      `Portable initialization: ${p(initPassed, modelDependentBlocked && !initPassed)}`
    );

    const { finalOutcome, exitCode } = decideFinalExitCode({
      bundle: bundleOutcome,
      discoveryAgents: discoveryAgentsOutcome,
      discoverySkills: discoverySkillsOutcome,
      init: initOutcome,
      protocol: protocolOutcome,
    });

    report.push(`\n## Final assessment\n\n${finalOutcome}`);

    console.log(report.join("\n"));
    process.exit(exitCode);
  } finally {
    for (const d of [
      tmpProjectDisc,
      tmpProjectInit,
      isoHome,
      isoConfig,
      isoBehaviorHome,
      isoBehaviorConfig,
    ]) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {}
    }
  }
}

/**
 * Pure helper used by tests: simulate report-line formatting when model is absent.
 * Must not throw; returns BLOCKED classification and safe command text.
 */
export function buildBlockedNoModelReportLines(opts: {
  projectDir: string;
  model?: string | null;
  authBlockedReason?: string;
  sanitize?: (s: string, max?: number) => string;
}): { commandLine: string; initClassification: string; protocolClassification: string; exitCode: number } {
  const sanitize = opts.sanitize || ((s: string) => s);
  const args = buildOpencodeRunArgs({
    projectDir: opts.projectDir,
    model: opts.model,
    command: "banca-init",
  });
  const commandLine = `opencode ${formatCliArgsForReport(args, sanitize)}`;
  const init = classifyInitPhase({
    hasAuthAndModel: false,
    authBlockedReason: sanitize(opts.authBlockedReason || "no model candidate selected", 200),
  });
  const protocol = classifyProtocolPhase({
    hasAuthAndModel: false,
    initPassed: false,
    authBlockedReason: sanitize(opts.authBlockedReason || "no model candidate selected", 200),
  });
  const decision = decideFinalExitCode({
    discoveryAgents: "PASS",
    discoverySkills: "PASS",
    init: init.outcome,
    protocol: protocol.outcome,
  });
  return {
    commandLine,
    initClassification: sanitize(init.classification, 500),
    protocolClassification: sanitize(protocol.classification, 500),
    exitCode: decision.exitCode,
  };
}

if (import.meta.main) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
