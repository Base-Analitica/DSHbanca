import { describe, test, expect } from "bun:test";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir, homedir } from "node:os";
import { pathToFileURL } from "node:url";
import {
  parseJsonEvents,
  verifyAgents,
  verifySkills,
  verifyInitEvents,
  verifyProtocolEvents,
  verifyExhaustiveProtocol,
  extractContextPackPath,
  isSinteseErrorOutput,
  isSinteseSuccessOutput,
  isIncompleteCoverageRejection,
  extractSinteseErrorCode,
  isMinimalAnalysisFindingShape,
  pathsMatchForRead,
  writeSyntheticMultiBatchProject,
  inspectExhaustiveProjectState,
  sanitizeOutput,
  createPathSanitizer,
  classifyInitPhase,
  classifyProtocolPhase,
  decideFinalExitCode,
  combineOutcomes,
  outcomeToExitCode,
  isTimedOut,
  normalizeToolEvent,
  normalizeAllToolEvents,
  isToolSuccess,
  detectAgentAttribution,
  ensureDistBundle,
  computeSourceFingerprint,
  resolveOpencodeProjectRoot,
  buildProjectRunEnv,
  buildOpencodeRunArgs,
  extractDirArg,
  isPwdAlignedWithCwd,
  isConfigIsolated,
  diagnoseOpencodeOutput,
  runSafe,
  formatCliArgsForReport,
  formatClassification,
  buildBlockedNoModelReportLines,
  seedIsolatedAuth,
  PRESERVED_ENV_KEYS,
  resolveBinary,
  opencodeModelE2eOptInError,
  hasStructuredProtocolFailure,
  normalizeTextEvent,
  normalizeAllTextEvents,
  evaluateGlobalSynthesis,
  validateGlobalSectionOrder,
  validateCrossBatchRelation,
  hasRelationalConclusion,
  stripGlobalSectionTitles,
  findForbiddenSynthesisLanguage,
  isJsonPassthroughReply,
  parseSinteseAllowlistFindings,
  extractCitedFindingIds,
  extractInventedFindingIds,
  findingTraceableInText,
  sectionIdCitedInWindow,
  filePathCitedInWindow,
  sessionsCorrelate,
  linesCitedInFindingWindow,
  extractSinteseEnvelopeAllowedIds,
  GLOBAL_SYNTHESIS_SECTIONS,
  type ProcessLike,
  type ProtocolEval,
  type ExhaustiveProjectState,
} from "../scripts/e2e-opencode";
import { spawnSync } from "node:child_process";

const runnerSource = readFileSync(join(import.meta.dir, "../scripts/e2e-opencode.ts"), "utf8");

function timedOutResult(overrides: Partial<ProcessLike> = {}): ProcessLike {
  const err = Object.assign(new Error("spawnSync ETIMEDOUT"), { code: "ETIMEDOUT" });
  return {
    stdout: "",
    stderr: "",
    status: null,
    signal: "SIGTERM",
    error: err,
    ...overrides,
  };
}

function failedResult(status: number, overrides: Partial<ProcessLike> = {}): ProcessLike {
  return {
    stdout: "",
    stderr: "process failed",
    status,
    signal: null,
    error: null,
    ...overrides,
  };
}

function okResult(stdout = ""): ProcessLike {
  return {
    stdout,
    stderr: "",
    status: 0,
    signal: null,
    error: null,
  };
}

const perfectInitEval = {
  foundTool: true,
  foundSuccess: true,
  hasProjectJson: true,
  hasStateJson: true,
  exactAgents: true,
  exactSkills: true,
  skillMdCount: 8,
};

const perfectProtocolEval: ProtocolEval = {
  skillArgsCorrect: true,
  skillEvidence: true,
  skillSucceeded: true,
  contextCalled: true,
  auditarCalled: true,
  correctOrder: true,
  hashesMatch: true,
  claimedSubagentWithoutEvidence: false,
  minBatchesMet: true,
  batchesCompleted: 3,
  multiBatchOrderCorrect: true,
  readsSucceeded: true,
  sameFingerprint: true,
  fingerprint: "fp-test",
  batchIds: ["b0", "b1", "b2"],
  sourceCoverageOk: true,
  sourcesObserved: ["first.tex", "middle.tex", "last.tex"],
  prematureSinteseAttempted: true,
  prematureSinteseRejected: true,
  finalSinteseSucceeded: true,
  findingsPersisted: true,
  findingsCount: 1,
  findingsNotDuplicatedOnResume: true,
  resumeAcrossProcesses: true,
  phase1Interrupted: true,
  globalSynthesisOk: true,
  globalReplyPresent: true,
  globalReplyAfterSintese: true,
  globalSectionsOrdered: true,
  globalCrossBatchRelation: true,
  globalFindingIdsAllowlisted: true,
  globalForbiddenLanguageAbsent: true,
  globalNotJsonPassthrough: true,
  globalSinteseEventIndex: 10,
  globalReplyEventIndex: 11,
  globalSectionsFound: [...GLOBAL_SYNTHESIS_SECTIONS],
  globalCitedFindingIds: ["fid-a", "fid-b"],
  globalCitedBatchIds: ["b0", "b2"],
  globalForbiddenTermsFound: [],
};

/** Partial protocol eval for FAIL-path classification tests (legacy fields only + exhaustive false). */
function protocolEvalFromPartial(
  partial: Partial<ProtocolEval> &
    Pick<
      ProtocolEval,
      | "skillArgsCorrect"
      | "skillEvidence"
      | "skillSucceeded"
      | "contextCalled"
      | "auditarCalled"
      | "correctOrder"
      | "hashesMatch"
      | "claimedSubagentWithoutEvidence"
    >
): ProtocolEval {
  return {
    minBatchesMet: false,
    batchesCompleted: 0,
    multiBatchOrderCorrect: false,
    readsSucceeded: false,
    sameFingerprint: false,
    fingerprint: null,
    batchIds: [],
    sourceCoverageOk: false,
    sourcesObserved: [],
    prematureSinteseAttempted: false,
    prematureSinteseRejected: false,
    finalSinteseSucceeded: false,
    findingsPersisted: false,
    findingsCount: 0,
    findingsNotDuplicatedOnResume: true,
    resumeAcrossProcesses: false,
    phase1Interrupted: false,
    globalSynthesisOk: false,
    globalReplyPresent: false,
    globalReplyAfterSintese: false,
    globalSectionsOrdered: false,
    globalCrossBatchRelation: false,
    globalFindingIdsAllowlisted: false,
    globalForbiddenLanguageAbsent: false,
    globalNotJsonPassthrough: false,
    globalSinteseEventIndex: null,
    globalReplyEventIndex: null,
    globalSectionsFound: [],
    globalCitedFindingIds: [],
    globalCitedBatchIds: [],
    globalForbiddenTermsFound: [],
    ...partial,
  };
}

/** Real OpenCode 1.17.18 tool_use envelope. */
function ocTool(
  tool: string,
  opts: {
    callID?: string;
    status?: string;
    input?: unknown;
    output?: unknown;
    error?: unknown;
    id?: string;
    sessionID?: string;
  } = {}
) {
  return {
    type: "tool_use",
    timestamp: Date.now(),
    sessionID: opts.sessionID ?? "ses_test",
    part: {
      id: opts.id || "prt_test",
      type: "tool",
      tool,
      callID: opts.callID || "call_test",
      state: {
        status: opts.status || "completed",
        input: opts.input ?? {},
        output: opts.output,
        error: opts.error,
      },
    },
  };
}

/**
 * Real OpenCode 1.17.18 completed assistant text event.
 * Emit path only writes when part.time.end is set.
 */
function ocText(
  text: string,
  opts: {
    id?: string;
    end?: number;
    sessionID?: string;
    /** When true, omit part.time entirely (incomplete envelope). */
    omitTime?: boolean;
  } = {}
) {
  const end = opts.end ?? Date.now();
  const part: Record<string, unknown> = {
    id: opts.id || "prt_text",
    type: "text",
    text,
  };
  if (!opts.omitTime) {
    part.time = { start: end - 5, end };
  }
  return {
    type: "text",
    timestamp: end,
    sessionID: opts.sessionID ?? "ses_test",
    part,
  };
}

describe("E2E Helpers", () => {
  test("parseJsonEvents - extracts objects line by line", () => {
    const raw = `{"event": "start"}
invalid json
{"toolName": "banca_init", "args": {}}
{"status": "completed"}`;
    const events = parseJsonEvents(raw);
    expect(events.length).toBe(3);
    expect(events[1].toolName).toBe("banca_init");
  });

  test("parseJsonEvents - extracts valid array string correctly", () => {
    const raw = `[{"event": "start"}, {"toolName": "banca_init"}]`;
    const events = parseJsonEvents(raw);
    expect(events.length).toBe(2);
    expect(events[1].toolName).toBe("banca_init");
  });

  test("verifyAgents - exact match", () => {
    const result = verifyAgents(`
banca-auditor (subagent)
banca-corretor (subagent)
banca-fontes (subagent)
banca-integrador (subagent)
banca-loop (subagent)
    `);
    expect(result).toBe("NO_MODEL_DISCOVERY_PASSED");
  });

  test("verifyAgents - missing agent", () => {
    const result = verifyAgents(`banca-auditor (subagent)\nbanca-corretor (subagent)`);
    expect(result).toContain("NO_MODEL_DISCOVERY_FAILED");
    expect(result).toContain("banca-loop");
  });

  test("verifyAgents - unexpected agent", () => {
    const result = verifyAgents(`
banca-auditor (subagent)
banca-corretor (subagent)
banca-fontes (subagent)
banca-integrador (subagent)
banca-loop (subagent)
banca-unexpected-agent (subagent)
    `);
    expect(result).toContain("NO_MODEL_DISCOVERY_FAILED");
    expect(result).toContain("banca-unexpected-agent");
  });

  test("verifySkills - exact match", () => {
    const result = verifySkills(`
{ "name": "banca-avaliacao" }
{ "name": "banca-correcao" }
{ "name": "banca-detector-ia" }
{ "name": "banca-grille" }
{ "name": "banca-plagio" }
{ "name": "banca-planejador" }
{ "name": "banca-referencias" }
{ "name": "banca-revisor" }
    `);
    expect(result).toBe("NO_MODEL_DISCOVERY_PASSED");
  });

  test("verifySkills - missing skill", () => {
    const result = verifySkills(`{ "name": "banca-avaliacao" }`);
    expect(result).toContain("NO_MODEL_DISCOVERY_FAILED");
    expect(result).toContain("banca-revisor");
  });

  test("verifyInitEvents - linked by ID", () => {
    const events = [
      { id: "123", toolName: "banca_init", arguments: {} },
      { id: "123", state: "success", result: "done" },
    ];
    const result = verifyInitEvents(events);
    expect(result.foundTool).toBe(true);
    expect(result.foundSuccess).toBe(true);
  });

  test("verifyInitEvents - mismatched ID fails", () => {
    const events = [
      { id: "123", toolName: "banca_init", arguments: {} },
      { id: "456", state: "success", result: "done" },
    ];
    const result = verifyInitEvents(events);
    expect(result.foundTool).toBe(true);
    expect(result.foundSuccess).toBe(false);
  });

  test("verifyInitEvents - result with different ID does not prove success", () => {
    const events = [
      { id: "call-1", toolName: "banca_init", arguments: {} },
      { call_id: "other-call", state: "success", result: "done" },
    ];
    const { foundTool, foundSuccess } = verifyInitEvents(events);
    expect(foundTool).toBe(true);
    expect(foundSuccess).toBe(false);
  });

  test("verifyInitEvents - explicit correlated error does not prove success", () => {
    const events = [
      { id: "123", toolName: "banca_init", arguments: {} },
      { id: "123", state: "error", error: "boom", result: "partial" },
    ];
    const result = verifyInitEvents(events);
    expect(result.foundTool).toBe(true);
    expect(result.foundSuccess).toBe(false);
  });

  test("verifyInitEvents - ignores tool_result masquerading as call", () => {
    const events = [{ type: "tool_result", toolName: "banca_init", state: "success" }];
    const result = verifyInitEvents(events);
    expect(result.foundTool).toBe(false);
  });

  test("verifyProtocolEvents - correct mapping and order", () => {
    // Fail-closed: explicit success status required (no bare-output success).
    const events = [
      { id: "A", tool: "skill", args: { name: "banca-avaliacao" }, state: "success", result: "# Skill: Banca Avaliação" },
      { id: "B", tool: "banca_context", state: "success", result: "Context returned" },
      { id: "C", tool: "banca_auditar", state: "success", result: "Audit returned" },
    ];
    const result = verifyProtocolEvents(events);
    expect(result.skillArgsCorrect).toBe(true);
    expect(result.skillEvidence).toBe(true);
    expect(result.skillSucceeded).toBe(true);
    expect(result.contextCalled).toBe(true);
    expect(result.auditarCalled).toBe(true);
    expect(result.correctOrder).toBe(true);
  });

  test("verifyProtocolEvents - output without status is not success", () => {
    const events = [
      { id: "A", tool: "skill", args: { name: "banca-avaliacao" } },
      { id: "A", result: "# Skill: Banca Avaliação" },
      { id: "B", tool: "banca_context", result: "Context returned" },
      { id: "C", tool: "banca_auditar", result: "Audit returned" },
    ];
    const result = verifyProtocolEvents(events);
    expect(result.skillEvidence).toBe(true);
    expect(result.skillSucceeded).toBe(false);
    expect(result.contextCalled).toBe(false);
    expect(result.auditarCalled).toBe(false);
  });

  test("verifyProtocolEvents - false positive on SKILL.md", () => {
    const events = [
      { id: "A", tool: "skill", args: { name: "banca-avaliacao" }, state: "success" },
      { id: "A", state: "success", result: "Failed to find SKILL.md" },
      { id: "B", tool: "banca_context", state: "success", result: "Context returned" },
      { id: "C", tool: "banca_auditar", state: "success", result: "Audit returned" },
    ];
    const result = verifyProtocolEvents(events);
    expect(result.skillEvidence).toBe(false);
    expect(result.skillSucceeded).toBe(false);
  });

  test("verifyProtocolEvents - skill error with partial content is not success", () => {
    const events = [
      ocTool("skill", {
        callID: "c1",
        status: "error",
        input: { name: "banca-avaliacao" },
        output: "# Skill: Banca Avaliação\npartial load before failure",
        error: "skill tool failed",
      }),
      ocTool("banca_context", {
        callID: "c2",
        status: "completed",
        output: "ctx",
      }),
      ocTool("banca_auditar", {
        callID: "c3",
        status: "completed",
        output: "audit",
      }),
    ];
    const r = verifyProtocolEvents(events);
    expect(r.skillArgsCorrect).toBe(true);
    expect(r.skillEvidence).toBe(true);
    expect(r.skillSucceeded).toBe(false);
    expect(r.contextCalled).toBe(true);
    expect(r.auditarCalled).toBe(true);
    // Order requires successful skill completion index; failed skill → incorrect order track.
    expect(r.correctOrder).toBe(false);

    const classified = classifyProtocolPhase({
      hasAuthAndModel: true,
      initPassed: true,
      result: okResult("{}"),
      evaluation: protocolEvalFromPartial({
        skillArgsCorrect: r.skillArgsCorrect,
        skillEvidence: r.skillEvidence,
        skillSucceeded: r.skillSucceeded,
        contextCalled: r.contextCalled,
        auditarCalled: r.auditarCalled,
        correctOrder: r.correctOrder,
        hashesMatch: true,
        claimedSubagentWithoutEvidence: false,
      }),
    });
    expect(classified.outcome).toBe("FAIL");
    expect(classified.passed).toBe(false);
  });

  test("verifyProtocolEvents - later error on same skill callId invalidates success", () => {
    const events = [
      ocTool("skill", {
        callID: "c1",
        status: "completed",
        input: { name: "banca-avaliacao" },
        output: "# Skill: Banca Avaliação\nloaded",
      }),
      // Correlated follow-up error on same callId must veto success.
      {
        type: "tool_use",
        part: {
          type: "tool",
          tool: "skill",
          callID: "c1",
          state: { status: "error", error: "late failure", output: "partial" },
        },
      },
      ocTool("banca_context", { callID: "c2", status: "completed", output: "ctx" }),
      ocTool("banca_auditar", { callID: "c3", status: "completed", output: "audit" }),
    ];
    const r = verifyProtocolEvents(events);
    expect(r.skillSucceeded).toBe(false);
  });

  test("verifyProtocolEvents - late error on banca_context is permanent (no re-enable)", () => {
    const events = [
      ocTool("skill", {
        callID: "c1",
        status: "completed",
        input: { name: "banca-avaliacao" },
        output: "# Skill: Banca Avaliação\nloaded",
      }),
      ocTool("banca_context", { callID: "c2", status: "completed", output: "ctx ok" }),
      ocTool("banca_context", { callID: "c2", status: "error", error: "late context fail", output: "ctx ok" }),
      ocTool("banca_auditar", { callID: "c3", status: "completed", output: "audit" }),
    ];
    const r = verifyProtocolEvents(events);
    expect(r.skillSucceeded).toBe(true);
    expect(r.contextCalled).toBe(false);
    expect(r.auditarCalled).toBe(true);

    const classified = classifyProtocolPhase({
      hasAuthAndModel: true,
      initPassed: true,
      result: okResult("{}"),
      evaluation: protocolEvalFromPartial({
        skillArgsCorrect: true,
        skillEvidence: true,
        skillSucceeded: true,
        contextCalled: r.contextCalled,
        auditarCalled: true,
        correctOrder: true,
        hashesMatch: true,
        claimedSubagentWithoutEvidence: false,
      }),
    });
    expect(classified.outcome).toBe("FAIL");
  });

  test("verifyProtocolEvents - late error on banca_auditar is permanent", () => {
    const events = [
      ocTool("skill", {
        callID: "c1",
        status: "completed",
        input: { name: "banca-avaliacao" },
        output: "# Skill: Banca Avaliação\nloaded",
      }),
      ocTool("banca_context", { callID: "c2", status: "completed", output: "ctx" }),
      ocTool("banca_auditar", { callID: "c3", status: "completed", output: "audit" }),
      ocTool("banca_auditar", { callID: "c3", status: "error", error: "late auditar fail" }),
    ];
    const r = verifyProtocolEvents(events);
    expect(r.auditarCalled).toBe(false);
  });

  test("verifyProtocolEvents - later skill callId cannot complete first skill call", () => {
    // c1 starts incomplete; c4 succeeds later. Order uses first call position historically;
    // success must NOT be borrowed from c4.
    const events = [
      ocTool("skill", {
        callID: "c1",
        status: "running",
        input: { name: "banca-avaliacao" },
        output: "# Skill: Banca Avaliação\npartial",
      }),
      ocTool("banca_context", { callID: "c2", status: "completed", output: "ctx" }),
      ocTool("banca_auditar", { callID: "c3", status: "completed", output: "audit" }),
      ocTool("skill", {
        callID: "c4",
        status: "completed",
        input: { name: "banca-avaliacao" },
        output: "# Skill: Banca Avaliação\nfull",
      }),
    ];
    const r = verifyProtocolEvents(events);
    expect(r.skillSucceeded).toBe(false);
    expect(r.contextCalled).toBe(true);
    expect(r.auditarCalled).toBe(true);
    expect(r.correctOrder).toBe(false);
  });

  test("verifyProtocolEvents - later context success cannot validate earlier incomplete context position", () => {
    const events = [
      ocTool("skill", {
        callID: "c1",
        status: "completed",
        input: { name: "banca-avaliacao" },
        output: "# Skill: Banca Avaliação\nloaded",
      }),
      ocTool("banca_context", { callID: "c2", status: "running", output: "partial" }),
      ocTool("banca_auditar", { callID: "c3", status: "completed", output: "audit" }),
      // Different callId succeeds after auditar — must not validate the earlier context track.
      ocTool("banca_context", { callID: "c9", status: "completed", output: "ctx late" }),
    ];
    const r = verifyProtocolEvents(events);
    expect(r.contextCalled).toBe(false);
    expect(r.correctOrder).toBe(false);
  });

  test("exit 0 with structured error on init forces BANCA_INIT_FAILED", () => {
    const stdout = [
      JSON.stringify({
        type: "tool_use",
        part: {
          type: "tool",
          tool: "banca_init",
          callID: "i1",
          state: { status: "completed", output: "ok" },
        },
      }),
      JSON.stringify({
        type: "error",
        error: { name: "UnknownError", data: { message: "Unexpected server error" } },
      }),
    ].join("\n");
    const diag = diagnoseOpencodeOutput(stdout, "");
    expect(diag.categories).toContain("opencode_error_event");

    const classified = classifyInitPhase({
      hasAuthAndModel: true,
      result: okResult(stdout),
      evaluation: {
        foundTool: true,
        foundSuccess: true,
        hasProjectJson: true,
        hasStateJson: true,
        exactAgents: true,
        exactSkills: true,
        skillMdCount: 8,
      },
      structuredFailureCategories: diag.categories,
    });
    expect(classified.outcome).toBe("FAIL");
    expect(classified.passed).toBe(false);
    expect(classified.classification).toContain("structured error");
    expect(
      decideFinalExitCode({
        discoveryAgents: "PASS",
        discoverySkills: "PASS",
        init: classified.outcome,
        protocol: "BLOCKED",
      }).exitCode
    ).toBe(1);
  });
});

describe("OpenCode 1.17 nested part events", () => {
  test("normalizeToolEvent maps part.tool / part.state / callID", () => {
    const n = normalizeToolEvent(
      ocTool("banca_init", {
        callID: "call_abc",
        status: "completed",
        input: { force: false },
        output: "initialized",
      })
    );
    expect(n).not.toBeNull();
    expect(n!.tool).toBe("banca_init");
    expect(n!.callId).toBe("call_abc");
    expect(n!.status).toBe("completed");
    expect(n!.output).toBe("initialized");
    expect(isToolSuccess(n!)).toBe(true);
  });

  test("nested completed banca_init proves success", () => {
    const events = [
      ocTool("banca_init", {
        callID: "call_1",
        status: "completed",
        output: "ok",
      }),
    ];
    const r = verifyInitEvents(events);
    expect(r.foundTool).toBe(true);
    expect(r.foundSuccess).toBe(true);
  });

  test("nested error banca_init does not prove success", () => {
    const events = [
      ocTool("banca_init", {
        callID: "call_1",
        status: "error",
        error: "boom",
        output: "partial",
      }),
    ];
    const r = verifyInitEvents(events);
    expect(r.foundTool).toBe(true);
    expect(r.foundSuccess).toBe(false);
  });

  test("nested incomplete status is not success", () => {
    const events = [
      ocTool("banca_init", {
        callID: "call_1",
        status: "running",
        output: undefined,
      }),
    ];
    const r = verifyInitEvents(events);
    expect(r.foundTool).toBe(true);
    expect(r.foundSuccess).toBe(false);
  });

  test("malformed event is not success", () => {
    const n = normalizeToolEvent(null);
    expect(n!.malformed).toBe(true);
    expect(isToolSuccess(n)).toBe(false);
  });

  test("nested protocol order skill → context → auditar with evidence", () => {
    const events = [
      ocTool("skill", {
        callID: "c1",
        status: "completed",
        input: { name: "banca-avaliacao" },
        output: '<skill_content name="banca-avaliacao">\n# Skill: Banca Avaliação\nbody',
      }),
      ocTool("banca_context", {
        callID: "c2",
        status: "completed",
        output: "ctx",
      }),
      ocTool("banca_auditar", {
        callID: "c3",
        status: "completed",
        output: "audit",
      }),
    ];
    const r = verifyProtocolEvents(events);
    expect(r.skillArgsCorrect).toBe(true);
    expect(r.skillEvidence).toBe(true);
    expect(r.skillSucceeded).toBe(true);
    expect(r.contextCalled).toBe(true);
    expect(r.auditarCalled).toBe(true);
    expect(r.correctOrder).toBe(true);
  });

  test("diagnoseOpencodeOutput reports structured tool_error even when exit would be 0", () => {
    const stdout = [
      JSON.stringify({
        type: "tool_use",
        part: {
          type: "tool",
          tool: "skill",
          callID: "c1",
          state: {
            status: "error",
            input: { name: "banca-avaliacao" },
            output: "# Skill: Banca Avaliação\npartial",
            error: "failed",
          },
        },
      }),
    ].join("\n");
    const diag = diagnoseOpencodeOutput(stdout, "");
    expect(diag.categories).toContain("tool_error");
    expect(diag.categories).toContain("tool_error:skill");
    // Must not invent model_provider from skill body text alone
    expect(diag.categories).not.toContain("model_provider_failure");
    expect(hasStructuredProtocolFailure(diag.categories)).toBe(true);
  });

  test("exit 0 with opencode_error_event forces protocol FAIL", () => {
    const stdout = [
      JSON.stringify({
        type: "tool_use",
        part: {
          type: "tool",
          tool: "skill",
          callID: "c1",
          state: {
            status: "completed",
            input: { name: "banca-avaliacao" },
            output: "# Skill: Banca Avaliação\nloaded",
          },
        },
      }),
      JSON.stringify({
        type: "tool_use",
        part: {
          type: "tool",
          tool: "banca_context",
          callID: "c2",
          state: { status: "completed", output: "ctx" },
        },
      }),
      JSON.stringify({
        type: "tool_use",
        part: {
          type: "tool",
          tool: "banca_auditar",
          callID: "c3",
          state: { status: "completed", output: "audit" },
        },
      }),
      JSON.stringify({
        type: "error",
        error: { name: "UnknownError", data: { message: "Unexpected server error" } },
      }),
    ].join("\n");

    const diag = diagnoseOpencodeOutput(stdout, "");
    expect(diag.categories).toContain("opencode_error_event");

    const verified = verifyProtocolEvents(parseJsonEvents(stdout));
    expect(verified.skillSucceeded).toBe(true);
    expect(verified.contextCalled).toBe(true);
    expect(verified.auditarCalled).toBe(true);

    const classified = classifyProtocolPhase({
      hasAuthAndModel: true,
      initPassed: true,
      result: okResult(stdout),
      evaluation: protocolEvalFromPartial({
        skillArgsCorrect: true,
        skillEvidence: true,
        skillSucceeded: true,
        contextCalled: true,
        auditarCalled: true,
        correctOrder: true,
        hashesMatch: true,
        claimedSubagentWithoutEvidence: false,
      }),
      structuredFailureCategories: diag.categories,
    });
    expect(classified.outcome).toBe("FAIL");
    expect(classified.passed).toBe(false);
    expect(classified.classification).toContain("structured error");

    const final = decideFinalExitCode({
      discoveryAgents: "PASS",
      discoverySkills: "PASS",
      init: "PASS",
      protocol: classified.outcome,
    });
    expect(final.exitCode).toBe(1);
    expect(final.finalOutcome).toBe("FAIL");
  });

  test("exit 0 with tool_error:skill forces protocol FAIL even if booleans look perfect", () => {
    const stdout = JSON.stringify({
      type: "tool_use",
      part: {
        type: "tool",
        tool: "skill",
        callID: "c1",
        state: {
          status: "error",
          input: { name: "banca-avaliacao" },
          output: "# Skill: Banca Avaliação\npartial",
          error: "boom",
        },
      },
    });
    const diag = diagnoseOpencodeOutput(stdout, "");
    const classified = classifyProtocolPhase({
      hasAuthAndModel: true,
      initPassed: true,
      result: okResult(stdout),
      evaluation: {
        // Even if evaluation were incorrectly perfect, structured categories must fail closed.
        ...perfectProtocolEval,
      },
      structuredFailureCategories: diag.categories,
    });
    expect(classified.outcome).toBe("FAIL");
    expect(decideFinalExitCode({
      discoveryAgents: "PASS",
      discoverySkills: "PASS",
      init: "PASS",
      protocol: classified.outcome,
    }).exitCode).toBe(1);
  });

  test("foreign callID result cannot complete another tool", () => {
    const events = [
      ocTool("skill", {
        callID: "c1",
        status: "running",
        input: { name: "banca-avaliacao" },
      }),
      // different call completes with skill body — must not attach to c1 unless same id
      ocTool("skill", {
        callID: "other",
        status: "completed",
        input: { name: "banca-avaliacao" },
        output: "# Skill: Banca Avaliação",
      }),
    ];
    // first skill is the one tracked; second is also skill so skillIdx is first
    // evidence can come from second skill call with correct args - that's a valid separate call
    // For init-style correlation:
    const initEvents = [
      ocTool("banca_init", { callID: "init1", status: "running" }),
      ocTool("banca_init", {
        callID: "other",
        status: "completed",
        output: "done",
      }),
    ];
    // both are banca_init calls - second succeeds with its own id
    const r = verifyInitEvents(initEvents);
    expect(r.foundTool).toBe(true);
    expect(r.foundSuccess).toBe(true);

    // Strict: success only for mismatched follow-up without banca_init tool on wrong id
    const strict = [
      { type: "tool_use", part: { type: "tool", tool: "banca_init", callID: "init1", state: { status: "running", input: {} } } },
      { type: "tool_use", part: { type: "tool", tool: "other_tool", callID: "other", state: { status: "completed", output: "x" } } },
    ];
    const r2 = verifyInitEvents(strict);
    expect(r2.foundTool).toBe(true);
    expect(r2.foundSuccess).toBe(false);
  });
});

describe("Agent attribution (subagent cannot be --agent)", () => {
  test("detects CLI fallback for subagent", () => {
    const attr = detectAgentAttribution({
      requestedAgent: "banca-auditor",
      stderr: '! agent "banca-auditor" is a subagent, not a primary agent. Falling back to default agent',
    });
    expect(attr.fallback).toBe(true);
    expect(attr.canClaimSubagent).toBe(false);
    expect(attr.observed).toBe("primary-default");
  });

  test("primary path does not claim banca-auditor", () => {
    const attr = detectAgentAttribution({ requestedAgent: null });
    expect(attr.canClaimSubagent).toBe(false);
    expect(attr.observed).toBe("primary-default");
  });

  test("protocol fails if claimed subagent without evidence", () => {
    const decision = classifyProtocolPhase({
      hasAuthAndModel: true,
      initPassed: true,
      result: okResult("{}"),
      evaluation: {
        ...perfectProtocolEval,
        claimedSubagentWithoutEvidence: true,
      },
    });
    expect(decision.outcome).toBe("FAIL");
    expect(decision.classification).toContain("banca-auditor");
  });

  test("runner source does not pass --agent banca-auditor", () => {
    expect(runnerSource).not.toMatch(/--agent",\s*"banca-auditor"/);
    expect(runnerSource).not.toMatch(/"--agent", "banca-auditor"/);
    expect(runnerSource).toContain("mode:subagent");
  });
});

describe("Discovery provenance (global contamination)", () => {
  test("skills with global location fail project provenance", () => {
    const project = mkdtempSync(join(tmpdir(), "e2e-prov-"));
    try {
      for (const s of [
        "banca-avaliacao",
        "banca-correcao",
        "banca-detector-ia",
        "banca-grille",
        "banca-plagio",
        "banca-planejador",
        "banca-referencias",
        "banca-revisor",
      ]) {
        const d = join(project, ".dsh", "skills", s);
        mkdirSync(d, { recursive: true });
        writeFileSync(join(d, "SKILL.md"), `---\nname: ${s}\ndescription: x\n---\n`);
      }
      const globalLoc = "/tmp/global-config/skills/banca-avaliacao/SKILL.md";
      const payload = JSON.stringify([
        { name: "banca-avaliacao", location: globalLoc },
        { name: "banca-correcao", location: join(project, ".dsh/skills/banca-correcao/SKILL.md") },
        { name: "banca-detector-ia", location: join(project, ".dsh/skills/banca-detector-ia/SKILL.md") },
        { name: "banca-grille", location: join(project, ".dsh/skills/banca-grille/SKILL.md") },
        { name: "banca-plagio", location: join(project, ".dsh/skills/banca-plagio/SKILL.md") },
        { name: "banca-planejador", location: join(project, ".dsh/skills/banca-planejador/SKILL.md") },
        { name: "banca-referencias", location: join(project, ".dsh/skills/banca-referencias/SKILL.md") },
        { name: "banca-revisor", location: join(project, ".dsh/skills/banca-revisor/SKILL.md") },
      ]);
      const result = verifySkills(payload, project);
      expect(result).toContain("NO_MODEL_DISCOVERY_FAILED");
      expect(result).toContain("provenance");
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("skills with project locations pass", () => {
    const project = mkdtempSync(join(tmpdir(), "e2e-prov-ok-"));
    try {
      const entries = [];
      for (const s of [
        "banca-avaliacao",
        "banca-correcao",
        "banca-detector-ia",
        "banca-grille",
        "banca-plagio",
        "banca-planejador",
        "banca-referencias",
        "banca-revisor",
      ]) {
        const d = join(project, ".dsh", "skills", s);
        mkdirSync(d, { recursive: true });
        const loc = join(d, "SKILL.md");
        writeFileSync(loc, `---\nname: ${s}\ndescription: x\n---\n`);
        entries.push({ name: s, location: loc });
      }
      expect(verifySkills(JSON.stringify(entries), project)).toBe("NO_MODEL_DISCOVERY_PASSED");
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("agents listed but missing from project .dsh fail", () => {
    const project = mkdtempSync(join(tmpdir(), "e2e-agents-"));
    try {
      const list = `
banca-auditor (subagent)
banca-corretor (subagent)
banca-fontes (subagent)
banca-integrador (subagent)
banca-loop (subagent)
`;
      // no local files
      const result = verifyAgents(list, project);
      expect(result).toContain("NO_MODEL_DISCOVERY_FAILED");
      expect(result).toContain("not present under project");
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe("Bundle freshness", () => {
  test("missing dist is not ok without rebuild", () => {
    const root = mkdtempSync(join(tmpdir(), "e2e-bundle-"));
    try {
      writeFileSync(join(root, "package.json"), "{}");
      // no dist
      const check = ensureDistBundle(root, { rebuild: false });
      expect(check.ok).toBe(false);
      expect(check.reason).toMatch(/missing|stamp/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("fingerprint is stable for same tree", () => {
    const root = process.cwd();
    const a = computeSourceFingerprint(root);
    const b = computeSourceFingerprint(root);
    expect(a).toBe(b);
    expect(a.length).toBe(64);
  });
});

describe("Utility Helpers", () => {
  test("sanitizeOutput - removes tokens", () => {
    const raw = "Bearer 12345ABCDE and my_token=secret123";
    const sanitized = sanitizeOutput(raw, 1000);
    expect(sanitized).toContain("Bearer [REDACTED]");
    expect(sanitized).toContain("[REDACTED]");
    expect(sanitized).not.toContain("12345ABCDE");
    expect(sanitized).not.toContain("secret123");
  });

  test("sanitizeOutput - secrets with punctuation", () => {
    // Use synthetic placeholders that exercise punctuation redaction without
    // matching repository secret scanners (no real provider key assignments).
    const raw =
      'my_api_key="sk-or-v1-abc.def+ghi/jkl=" Authorization: Bearer tok_value.with-dots+plus/slash=end';
    const sanitized = sanitizeOutput(raw, 2000);
    expect(sanitized).not.toContain("sk-or-v1-abc");
    expect(sanitized).not.toContain("tok_value.with-dots");
    expect(sanitized).toContain("[REDACTED]");
  });

  test("sanitizeOutput - path sanitizer masks HOME/repo/tmp", () => {
    const home = homedir();
    const repo = process.cwd();
    const tmp = tmpdir();
    const sanitizer = createPathSanitizer({ home, repoRoot: repo, tempRoots: [tmp] });
    const raw = `bin=${home}/.bun/bin/opencode file=${pathToFileURL(join(repo, "dist/index.js")).href} tmp=${tmp}/xyz`;
    const sanitized = sanitizeOutput(raw, 2000, sanitizer);
    expect(sanitized).not.toContain(home);
    expect(sanitized).toContain("<HOME>");
    expect(sanitized).toContain("<REPO>");
  });

  test("sanitizeOutput - limits output size", () => {
    const raw = "A".repeat(1500);
    const sanitized = sanitizeOutput(raw, 1000);
    expect(sanitized.length).toBe(1000 + "\n...[TRUNCATED]".length);
    expect(sanitized.endsWith("[TRUNCATED]")).toBe(true);
  });

  test("isTimedOut detects ETIMEDOUT", () => {
    expect(isTimedOut(timedOutResult())).toBe(true);
    expect(isTimedOut(failedResult(1))).toBe(false);
    expect(isTimedOut(okResult())).toBe(false);
  });
});

describe("Fail-closed final exit decisions", () => {
  test("init timeout results in final exit code 1", () => {
    const init = classifyInitPhase({
      hasAuthAndModel: true,
      result: timedOutResult(),
    });
    expect(init.classification).toContain("BANCA_INIT_FAILED");
    expect(init.outcome).toBe("FAIL");
    const decision = decideFinalExitCode({
      discoveryAgents: "PASS",
      discoverySkills: "PASS",
      init: init.outcome,
      protocol: "BLOCKED",
    });
    expect(decision.exitCode).toBe(1);
  });

  test("init non-zero exit results in final exit code 1", () => {
    const init = classifyInitPhase({
      hasAuthAndModel: true,
      result: failedResult(7),
    });
    expect(init.outcome).toBe("FAIL");
    const decision = decideFinalExitCode({
      discoveryAgents: "PASS",
      discoverySkills: "PASS",
      init: init.outcome,
      protocol: classifyProtocolPhase({
        hasAuthAndModel: true,
        initPassed: false,
      }).outcome,
    });
    expect(decision.exitCode).toBe(1);
  });

  test("protocol timeout results in final exit code 1", () => {
    const protocol = classifyProtocolPhase({
      hasAuthAndModel: true,
      initPassed: true,
      result: timedOutResult(),
    });
    expect(protocol.outcome).toBe("FAIL");
    expect(
      decideFinalExitCode({
        discoveryAgents: "PASS",
        discoverySkills: "PASS",
        init: "PASS",
        protocol: protocol.outcome,
      }).exitCode
    ).toBe(1);
  });

  test("protocol non-zero exit results in final exit code 1", () => {
    const protocol = classifyProtocolPhase({
      hasAuthAndModel: true,
      initPassed: true,
      result: failedResult(3),
    });
    expect(protocol.outcome).toBe("FAIL");
    expect(
      decideFinalExitCode({
        discoveryAgents: "PASS",
        discoverySkills: "PASS",
        init: "PASS",
        protocol: protocol.outcome,
      }).exitCode
    ).toBe(1);
  });

  test("no model with discovery passed results in exit code 2", () => {
    const decision = decideFinalExitCode({
      discoveryAgents: "PASS",
      discoverySkills: "PASS",
      init: classifyInitPhase({ hasAuthAndModel: false }).outcome,
      protocol: classifyProtocolPhase({ hasAuthAndModel: false, initPassed: false }).outcome,
    });
    expect(decision.finalOutcome).toBe("BLOCKED");
    expect(decision.exitCode).toBe(2);
  });

  test("discovery fail + missing model results in exit code 1 not 2", () => {
    const decision = decideFinalExitCode({
      discoveryAgents: "FAIL",
      discoverySkills: "PASS",
      init: "BLOCKED",
      protocol: "BLOCKED",
    });
    expect(decision.exitCode).toBe(1);
    expect(outcomeToExitCode(combineOutcomes("FAIL", "BLOCKED"))).toBe(1);
  });

  test("init fails with model available and protocol is not labeled auth-blocked", () => {
    const protocol = classifyProtocolPhase({
      hasAuthAndModel: true,
      initPassed: false,
      authBlockedReason: "should not appear",
    });
    expect(protocol.outcome).toBe("FAIL");
    expect(protocol.classification).not.toContain("BLOCKED");
    expect(protocol.classification).toContain("prerequisite");
  });

  test("bundle fail forces final FAIL over BLOCKED", () => {
    const decision = decideFinalExitCode({
      bundle: "FAIL",
      discoveryAgents: "PASS",
      discoverySkills: "PASS",
      init: "BLOCKED",
      protocol: "BLOCKED",
    });
    expect(decision.finalOutcome).toBe("FAIL");
    expect(decision.exitCode).toBe(1);
  });

  test("perfect phases yield PASS exit 0", () => {
    const decision = decideFinalExitCode({
      discoveryAgents: "PASS",
      discoverySkills: "PASS",
      init: classifyInitPhase({
        hasAuthAndModel: true,
        result: okResult("{}"),
        evaluation: perfectInitEval,
      }).outcome,
      protocol: classifyProtocolPhase({
        hasAuthAndModel: true,
        initPassed: true,
        result: okResult("{}"),
        evaluation: perfectProtocolEval,
      }).outcome,
    });
    expect(decision.finalOutcome).toBe("PASS");
    expect(decision.exitCode).toBe(0);
  });

  test("subprocess missing binary treated as blocked only at preflight — deterministic fail uses code 1", () => {
    const missing = {
      status: null,
      error: Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }),
      stdout: "",
      stderr: "",
      signal: null,
    } as ProcessLike;
    // non-timeout process error with null status after auth → fail via exit code path
    const init = classifyInitPhase({
      hasAuthAndModel: true,
      result: { ...missing, status: 127 },
    });
    expect(init.outcome).toBe("FAIL");
  });
});

describe("Runner source hygiene", () => {
  test("runner has no hardcoded /home/jules or temporary base branch", () => {
    expect(runnerSource).not.toContain("/home/jules");
    expect(runnerSource).not.toContain("fix-skills-frontmatter-");
    expect(runnerSource).not.toContain("origin/fix-skills-frontmatter");
    expect(runnerSource).not.toContain("execSync(");
    expect(runnerSource).toContain("shell: false");
  });
});

describe("PWD / cwd / --dir isolation (OpenCode 1.17.18)", () => {
  test("PWD=A with cwd=B and --dir . resolves to A (divergence)", () => {
    const A = resolve("/tmp/opencode-pwd-A");
    const B = resolve("/tmp/opencode-pwd-B");
    const resolved = resolveOpencodeProjectRoot({ pwd: A, cwd: B, dirArg: "." });
    expect(resolved).toBe(A);
    expect(resolved).not.toBe(B);
  });

  test("absolute --dir wins over divergent PWD", () => {
    const A = resolve("/tmp/opencode-pwd-A");
    const B = resolve("/tmp/opencode-pwd-B");
    const resolved = resolveOpencodeProjectRoot({ pwd: A, cwd: B, dirArg: B });
    expect(resolved).toBe(B);
  });

  test("buildProjectRunEnv forces PWD === absolute project root and isolates config", () => {
    const project = mkdtempSync(join(tmpdir(), "e2e-pwd-env-"));
    const isoHome = mkdtempSync(join(tmpdir(), "e2e-iso-home-"));
    const isoConfig = mkdtempSync(join(tmpdir(), "e2e-iso-cfg-"));
    try {
      const env = buildProjectRunEnv(project, {
        isolateHome: isoHome,
        isolateConfigDir: isoConfig,
        seedAuth: false,
        base: { ...process.env, PWD: "/tmp/foreign-pwd", OPENCODE_CONFIG_DIR: "/tmp/host-config" },
      });
      expect(isPwdAlignedWithCwd(env, project)).toBe(true);
      expect(resolve(env.PWD!)).toBe(resolve(project));
      expect(isConfigIsolated(env, isoConfig)).toBe(true);
      expect(resolve(env.HOME!)).toBe(resolve(isoHome));
      expect(env.OPENCODE_DISABLE_DEFAULT_PLUGINS).toBe("1");
      expect(env.OPENCODE_DISABLE_EXTERNAL_SKILLS).toBe("1");
    } finally {
      rmSync(project, { recursive: true, force: true });
      rmSync(isoHome, { recursive: true, force: true });
      rmSync(isoConfig, { recursive: true, force: true });
    }
  });

  test("buildOpencodeRunArgs uses absolute --dir for init and protocol", () => {
    const project = mkdtempSync(join(tmpdir(), "e2e-dir-abs-"));
    try {
      const initArgs = buildOpencodeRunArgs({
        projectDir: project,
        model: "opencode/mimo-v2.5-free",
        command: "banca-init",
      });
      const protoArgs = buildOpencodeRunArgs({
        projectDir: project,
        model: "opencode/mimo-v2.5-free",
        prompt: "run protocol",
      });
      const initDir = extractDirArg(initArgs);
      const protoDir = extractDirArg(protoArgs);
      expect(initDir).toBe(resolve(project));
      expect(protoDir).toBe(resolve(project));
      expect(initDir).not.toBe(".");
      expect(protoDir).not.toBe(".");
      // same isolation for both phases
      expect(initDir).toBe(protoDir);
      expect(initArgs).toContain("--command");
      expect(initArgs).toContain("banca-init");
      expect(protoArgs).toContain("run protocol");
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("runSafe forces PWD to cwd even when caller env has foreign PWD", () => {
    const project = mkdtempSync(join(tmpdir(), "e2e-runsafe-pwd-"));
    const foreign = mkdtempSync(join(tmpdir(), "e2e-runsafe-foreign-"));
    try {
      const script = join(project, "print-pwd.js");
      writeFileSync(
        script,
        `console.log(JSON.stringify({ pwd: process.env.PWD, cwd: process.cwd() }));\n`
      );
      const env = { ...process.env, PWD: foreign };
      const result = runSafe(process.execPath, [script], project, 10000, env);
      expect(result.status).toBe(0);
      const parsed = JSON.parse((result.stdout || "").trim());
      expect(resolve(parsed.pwd)).toBe(resolve(project));
      expect(resolve(parsed.cwd)).toBe(resolve(project));
      expect(resolve(parsed.pwd)).not.toBe(resolve(foreign));
    } finally {
      rmSync(project, { recursive: true, force: true });
      rmSync(foreign, { recursive: true, force: true });
    }
  });

  test("diagnoseOpencodeOutput parses JSON error on non-zero exit path without raw leak", () => {
    // Use a synthetic secret shape that exercises sanitizers without matching repo secret scanners.
    const secret = "tok_SYNTHETIC_SECRET_VALUE_DO_NOT_LEAK";
    const privatePath = join(homedir(), ".secrets", "token.txt");
    const stdout = [
      JSON.stringify({
        type: "error",
        error: {
          name: "UnknownError",
          data: { message: `Unexpected server error at ${privatePath} token=${secret}` },
        },
      }),
      JSON.stringify({
        type: "tool_use",
        part: {
          type: "tool",
          tool: "banca_init",
          callID: "c1",
          state: { status: "error", error: `plugin failed to load ${secret}`, input: {} },
        },
      }),
    ].join("\n");
    const diag = diagnoseOpencodeOutput(stdout, `plugin load failure for openbanca path=${privatePath}`);
    expect(diag.events.length).toBe(2);
    expect(diag.categories).toContain("opencode_error_event");
    expect(diag.categories).toContain("opencode_internal_error");
    expect(diag.categories).toContain("tool_error");
    expect(diag.categories).toContain("plugin_load_failure");
    // summary is category-only
    expect(diag.summary).not.toContain(secret);
    expect(diag.summary).not.toContain(privatePath);
    expect(diag.summary).not.toContain(homedir());

    const classified = classifyInitPhase({
      hasAuthAndModel: true,
      result: failedResult(1, { stdout, stderr: `plugin load failure ${secret} ${privatePath}` }),
    });
    expect(classified.outcome).toBe("FAIL");
    expect(classified.classification).toContain("exit code 1");
    expect(classified.classification).toContain("plugin_load_failure");
    expect(classified.classification).not.toContain(secret);
    expect(classified.classification).not.toContain(privatePath);
  });

  test("command_not_found diagnosis is fail-closed", () => {
    const diag = diagnoseOpencodeOutput("", "Error: command banca-init not found");
    expect(diag.categories).toContain("command_not_found");
    const c = classifyInitPhase({
      hasAuthAndModel: true,
      result: failedResult(1, { stderr: "command banca-init not found" }),
    });
    expect(c.outcome).toBe("FAIL");
    expect(c.classification).toContain("command_not_found");
  });

  test("timeout remains fail-closed without false BLOCKED", () => {
    const c = classifyInitPhase({
      hasAuthAndModel: true,
      result: timedOutResult(),
    });
    expect(c.outcome).toBe("FAIL");
    expect(c.classification).toContain("timeout");
  });

  test("file presence alone does not prove init success without tool events", () => {
    // evaluation with artifacts but no tool success must fail
    const c = classifyInitPhase({
      hasAuthAndModel: true,
      result: okResult("{}"),
      evaluation: {
        foundTool: false,
        foundSuccess: false,
        hasProjectJson: true,
        hasStateJson: true,
        exactAgents: true,
        exactSkills: true,
        skillMdCount: 8,
      },
    });
    expect(c.passed).toBe(false);
    expect(c.outcome).toBe("FAIL");
    expect(c.classification).toContain("banca_init");
  });

  test("diagnosis and paths stay sanitized in reports", () => {
    const home = homedir();
    const sanitizer = createPathSanitizer({ home, repoRoot: process.cwd(), tempRoots: [tmpdir()] });
    const raw = `error at ${home}/.config/opencode/plugin failed`;
    const sanitized = sanitizeOutput(raw, 500, sanitizer);
    expect(sanitized).not.toContain(home);
    expect(sanitized).toContain("<HOME>");
  });
});

describe("No-model path, sanitization of classification, host isolation", () => {
  test("buildOpencodeRunArgs omits --model when model missing and never returns non-strings", () => {
    const project = mkdtempSync(join(tmpdir(), "e2e-nomodel-args-"));
    try {
      for (const model of [undefined, null, "", "  " as any]) {
        const args = buildOpencodeRunArgs({
          projectDir: project,
          model: model as any,
          command: "banca-init",
        });
        expect(args.every((a) => typeof a === "string")).toBe(true);
        expect(args).not.toContain("--model");
        expect(args.includes(undefined as any)).toBe(false);
        // format must not throw
        expect(() => formatCliArgsForReport(args)).not.toThrow();
        expect(formatCliArgsForReport([...(args as any), undefined as any])).toContain("<missing>");
      }
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("no-model runner flow returns BLOCKED exit 2 without TypeError", () => {
    const project = mkdtempSync(join(tmpdir(), "e2e-nomodel-flow-"));
    try {
      const home = homedir();
      const sanitizer = createPathSanitizer({ home, repoRoot: process.cwd(), tempRoots: [tmpdir()] });
      const SF = (s: string, max?: number) => sanitizeOutput(s, max ?? 1000, sanitizer);
      const leak = "tok_abcdefghijklmnopqrstuvwx";
      const report = buildBlockedNoModelReportLines({
        projectDir: project,
        model: undefined,
        authBlockedReason: `no model; my_api_key=${leak} path=${home}/.ssh/id_rsa`,
        sanitize: SF,
      });
      expect(report.exitCode).toBe(2);
      expect(report.initClassification).toContain("BANCA_INIT_BLOCKED");
      expect(report.protocolClassification).toContain("MODEL_PROTOCOL_BLOCKED");
      expect(report.commandLine).toContain("banca-init");
      expect(report.commandLine).not.toContain("undefined");
      expect(report.initClassification).not.toContain(leak);
      expect(report.initClassification).not.toContain(home);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("classification never embeds raw error payloads with secrets/paths", () => {
    const secret = "tok_FAKE_SECRET_VALUE_1234567890";
    const privatePath = `${homedir()}/.config/opencode/auth.json`;
    const stdout = JSON.stringify({
      type: "error",
      error: { name: "UnknownError", data: { message: `boom ${secret} at ${privatePath}` } },
    });
    const result = classifyInitPhase({
      hasAuthAndModel: true,
      result: failedResult(1, { stdout, stderr: `my_token=${secret} file=${privatePath}` }),
    });
    expect(result.outcome).toBe("FAIL");
    expect(result.classification).not.toContain(secret);
    expect(result.classification).not.toContain(privatePath);
    expect(result.classification).not.toContain(homedir());
    // Still informative via categories
    expect(result.classification).toMatch(/opencode_error_event|opencode_internal_error|exit code 1/);
  });

  test("formatClassification is structured-only", () => {
    const line = formatClassification("BANCA_INIT_FAILED — exit code 1", [
      "plugin_load_failure",
      "tool_error:banca_init",
    ]);
    expect(line).toContain("plugin_load_failure");
    expect(line).toContain("categories:");
    expect(line).not.toContain("/home/");
  });

  test("global host config path is not used for behavioral env", () => {
    const project = mkdtempSync(join(tmpdir(), "e2e-iso-beh-"));
    const isoHome = mkdtempSync(join(tmpdir(), "e2e-iso-beh-home-"));
    const isoConfig = mkdtempSync(join(tmpdir(), "e2e-iso-beh-cfg-"));
    // Plant a fake global plugin in a host-like config that must NOT be selected
    const fakeHostConfig = mkdtempSync(join(tmpdir(), "e2e-fake-host-cfg-"));
    try {
      mkdirSync(join(fakeHostConfig, "plugins"), { recursive: true });
      writeFileSync(
        join(fakeHostConfig, "plugins", "openbanca-global-fake.ts"),
        `export default function(){ throw new Error("GLOBAL_PLUGIN_SHOULD_NOT_LOAD"); }\n`
      );
      const env = buildProjectRunEnv(project, {
        isolateHome: isoHome,
        isolateConfigDir: isoConfig,
        seedAuth: false,
        base: {
          ...process.env,
          OPENCODE_CONFIG_DIR: fakeHostConfig,
          HOME: join(tmpdir(), "real-host-home-should-not-apply"),
        },
      });
      expect(resolve(env.OPENCODE_CONFIG_DIR!)).toBe(resolve(isoConfig));
      expect(resolve(env.OPENCODE_CONFIG_DIR!)).not.toBe(resolve(fakeHostConfig));
      expect(existsSync(join(isoConfig, "plugins", "openbanca-global-fake.ts"))).toBe(false);
      // Host config pollution must not be visible inside isolated config
      expect(env.OPENCODE_DISABLE_DEFAULT_PLUGINS).toBe("1");
    } finally {
      rmSync(project, { recursive: true, force: true });
      rmSync(isoHome, { recursive: true, force: true });
      rmSync(isoConfig, { recursive: true, force: true });
      rmSync(fakeHostConfig, { recursive: true, force: true });
    }
  });

  test("seedIsolatedAuth copies only auth.json not plugins", () => {
    const host = mkdtempSync(join(tmpdir(), "e2e-host-auth-"));
    const iso = mkdtempSync(join(tmpdir(), "e2e-iso-auth-"));
    try {
      const authDir = join(host, ".local", "share", "opencode");
      mkdirSync(authDir, { recursive: true });
      writeFileSync(join(authDir, "auth.json"), JSON.stringify({ providers: { test: true } }));
      mkdirSync(join(host, ".config", "opencode", "plugins"), { recursive: true });
      writeFileSync(join(host, ".config", "opencode", "plugins", "evil.ts"), "export default 1\n");
      const result = seedIsolatedAuth(iso, host);
      expect(result.seeded).toBe(true);
      expect(existsSync(join(iso, ".local", "share", "opencode", "auth.json"))).toBe(true);
      expect(existsSync(join(iso, ".config", "opencode", "plugins", "evil.ts"))).toBe(false);
    } finally {
      rmSync(host, { recursive: true, force: true });
      rmSync(iso, { recursive: true, force: true });
    }
  });

  test("allowlist excludes host runtime pointers NODE_OPTIONS/BUN_INSTALL/XDG_RUNTIME_DIR", () => {
    expect(PRESERVED_ENV_KEYS).not.toContain("NODE_OPTIONS");
    expect(PRESERVED_ENV_KEYS).not.toContain("BUN_INSTALL");
    expect(PRESERVED_ENV_KEYS).not.toContain("XDG_RUNTIME_DIR");
    const project = mkdtempSync(join(tmpdir(), "e2e-allow-"));
    const isoHome = mkdtempSync(join(tmpdir(), "e2e-allow-home-"));
    const isoConfig = mkdtempSync(join(tmpdir(), "e2e-allow-cfg-"));
    try {
      const env = buildProjectRunEnv(project, {
        isolateHome: isoHome,
        isolateConfigDir: isoConfig,
        seedAuth: false,
        base: {
          PATH: "/usr/bin",
          NODE_OPTIONS: "--require=/tmp/evil-host-hook.js",
          BUN_INSTALL: "/tmp/host-bun",
          XDG_RUNTIME_DIR: "/tmp/host-runtime",
          OPENCODE_E2E_MODEL: "opencode/mimo-v2.5-free",
        },
      });
      expect(env.NODE_OPTIONS).toBeUndefined();
      expect(env.BUN_INSTALL).toBeUndefined();
      expect(env.XDG_RUNTIME_DIR).toBeUndefined();
      expect(env.OPENCODE_E2E_MODEL).toBe("opencode/mimo-v2.5-free");
    } finally {
      rmSync(project, { recursive: true, force: true });
      rmSync(isoHome, { recursive: true, force: true });
      rmSync(isoConfig, { recursive: true, force: true });
    }
  });

  test(
    "real process: no OpenCode binary available exits with code 2 (BLOCKED), no TypeError",
    () => {
      // Keep bun/node on PATH for rebuild, but exclude directories that contain opencode.
      const emptyHome = mkdtempSync(join(tmpdir(), "e2e-empty-home-"));
      const binDir = mkdtempSync(join(tmpdir(), "e2e-path-bins-"));
      try {
        // Symlink bun (and node if present) into a clean PATH so rebuild works without opencode.
        const bunPath = spawnSync("bash", ["-lc", "command -v bun"], { encoding: "utf8" }).stdout?.trim();
        const nodePath = spawnSync("bash", ["-lc", "command -v node"], { encoding: "utf8" }).stdout?.trim();
        if (bunPath) spawnSync("ln", ["-sf", bunPath, join(binDir, "bun")]);
        if (nodePath) spawnSync("ln", ["-sf", nodePath, join(binDir, "node")]);
        // Also need tsc via bun run; package scripts use bun.

        const result = spawnSync(bunPath || "bun", ["run", "scripts/e2e-opencode.ts"], {
          cwd: process.cwd(),
          encoding: "utf8",
          env: {
            PATH: binDir,
            HOME: emptyHome,
            OPENCODE_BIN: join(binDir, "no-such-opencode"),
            TMPDIR: tmpdir(),
            // Rebuild is fine (no opencode needed); avoids FAIL from missing stamp dominating exit.
            E2E_SKIP_REBUILD: "0",
            DSHBANCA_ENABLE_OPENCODE_MODEL_E2E: "1",
            DSHBANCA_ALLOW_OPENCODE_E2E_HOST_AUTH: "1",
            OPENCODE_E2E_MODEL: "fixture/no-provider-model",
          },
          timeout: 120000,
        });
        const out = `${result.stdout || ""}\n${result.stderr || ""}`;
        expect(result.status).toBe(2);
        expect(out).not.toMatch(/TypeError/i);
        expect(out).toMatch(/BLOCKED|NOT FOUND/i);
      } finally {
        rmSync(emptyHome, { recursive: true, force: true });
        rmSync(binDir, { recursive: true, force: true });
      }
    },
    { timeout: 150000 }
  );

  // The model-dependent OpenCode proof requires explicit model and host-auth consent, and a discoverable binary.
  const modelE2eOptInError = opencodeModelE2eOptInError();
  const openCodeBinForDynamicProof = modelE2eOptInError ? undefined : resolveBinary();

  test.skipIf(Boolean(modelE2eOptInError) || !openCodeBinForDynamicProof)(
    "real OpenCode: contaminated host config does not load global plugin; local banca_init completes",
    () => {
      const bin = openCodeBinForDynamicProof as string;
      const repo = process.cwd();
      const project = mkdtempSync(join(tmpdir(), "e2e-contam-proj-"));
      const isoHome = mkdtempSync(join(tmpdir(), "e2e-contam-home-"));
      const isoConfig = mkdtempSync(join(tmpdir(), "e2e-contam-cfg-"));
      const fakeHostConfig = mkdtempSync(join(tmpdir(), "e2e-contam-hostcfg-"));
      const marker = join(project, "GLOBAL_PLUGIN_LOADED.marker");

      try {
        spawnSync("git", ["init"], { cwd: project, encoding: "utf8" });
        mkdirSync(join(project, ".dsh", "commands"), { recursive: true });
        mkdirSync(join(project, ".dsh", "plugins"), { recursive: true });
        writeFileSync(
          join(project, ".dsh", "commands", "banca-init.md"),
          readFileSync(join(repo, "assets/dsh/commands/banca-init.md"))
        );
        const distPath = join(repo, "dist", "index.js");
        if (!existsSync(distPath)) {
          const build = spawnSync("bun", ["run", "build"], {
            cwd: repo,
            encoding: "utf8",
            timeout: 120000,
          });
          expect(build.status).toBe(0);
        }
        const stamp = ensureDistBundle(repo, { rebuild: true });
        expect(stamp.ok).toBe(true);
        expect(existsSync(distPath)).toBe(true);

        const pluginUrl = pathToFileURL(distPath).href;
        writeFileSync(
          join(project, ".dsh", "plugins", "openbanca-e2e.ts"),
          `export { default } from ${JSON.stringify(pluginUrl)};\n`
        );
        writeFileSync(
          join(project, "main.tex"),
          "\\documentclass{article}\\begin{document}x\\end{document}\n"
        );

        // Contaminating host-like plugin: creates a marker if ever evaluated.
        mkdirSync(join(fakeHostConfig, "plugins"), { recursive: true });
        writeFileSync(
          join(fakeHostConfig, "plugins", "openbanca-global-fake.ts"),
          `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(marker)}, "GLOBAL_LOADED");
export default async () => ({});
`
        );

        const env = buildProjectRunEnv(project, {
          isolateHome: isoHome,
          isolateConfigDir: isoConfig,
          hostHome: process.env.HOME || homedir(),
          seedAuth: true,
          base: {
            PATH: process.env.PATH,
            OPENCODE_CONFIG_DIR: fakeHostConfig,
            HOME: join(tmpdir(), "should-not-be-used-as-home"),
            NODE_OPTIONS: "--require=/tmp/should-not-load.js",
            OPENCODE_E2E_MODEL: process.env.OPENCODE_E2E_MODEL || "opencode/mimo-v2.5-free",
          },
        });

        expect(resolve(env.OPENCODE_CONFIG_DIR!)).toBe(resolve(isoConfig));
        expect(isConfigIsolated(env, isoConfig)).toBe(true);
        expect(env.NODE_OPTIONS).toBeUndefined();
        expect(existsSync(join(isoConfig, "plugins", "openbanca-global-fake.ts"))).toBe(false);

        const args = buildOpencodeRunArgs({
          projectDir: project,
          model: process.env.OPENCODE_E2E_MODEL,
          command: "banca-init",
        });
        const res = runSafe(bin, args, project, 240000, env);

        // Global contaminant must never run.
        expect(existsSync(marker)).toBe(false);

        // Full behavioral proof is required when OpenCode is available in the environment.
        // Soft-passing on non-zero status is not allowed: that overstated isolation confidence.
        // Timeout (status null) is environmental FAIL, not a soft pass.
        expect(res.status).toBe(0);
        const { foundTool, foundSuccess } = verifyInitEvents(parseJsonEvents(res.stdout || ""));
        expect(foundTool).toBe(true);
        expect(foundSuccess).toBe(true);
        expect(existsSync(join(project, ".banca", "project.json"))).toBe(true);
        expect(existsSync(join(project, ".banca", "state.json"))).toBe(true);
      } finally {
        rmSync(project, { recursive: true, force: true });
        rmSync(isoHome, { recursive: true, force: true });
        rmSync(isoConfig, { recursive: true, force: true });
        rmSync(fakeHostConfig, { recursive: true, force: true });
      }
    },
    { timeout: 300000 }
  );
  // If OpenCode is absent, the contamination proof above is skipped (not counted as PASS).
});

describe("Exhaustive multi-batch protocol evaluators (issue #88)", () => {
  function oc(
    tool: string,
    opts: {
      id?: string;
      status?: string;
      input?: unknown;
      output?: unknown;
      error?: unknown;
    } = {}
  ) {
    return ocTool(tool, {
      callID: opts.id || `call_${tool}`,
      status: opts.status || "completed",
      input: opts.input ?? {},
      output: opts.output,
      error: opts.error,
    });
  }

  const projectRoot = resolve("/tmp/e2e-exhaustive-proj");
  const pack1 = join(projectRoot, ".banca/context/context-1.md");
  const pack2 = join(projectRoot, ".banca/context/context-2.md");
  const pack3 = join(projectRoot, ".banca/context/context-3.md");
  const packDone = join(projectRoot, ".banca/context/context-done.md");
  const fp = "fingerprint-abc";
  const b0 = "batch-0";
  const b1 = "batch-1";
  const b2 = "batch-2";

  const findingPhase1 = {
    version: "analysis-finding-v1",
    findingId: "fid-phase1",
    planId: "p1",
    category: "coherence",
    severity: "medium",
    claim: "O objetivo afirma ganho significativo com Alpha.",
    evidence: "trecho do objetivo em first.tex",
    file: "first.tex",
    startLine: 2,
    endLine: 4,
    sectionId: "sec-objetivos",
    manuscriptFingerprint: fp,
    batchId: b0,
  };

  const findingPhase2 = {
    version: "analysis-finding-v1",
    findingId: "fid-phase2-last",
    planId: "p1",
    category: "coherence",
    severity: "high",
    claim: "A conclusao refuta qualquer melhoria de Alpha.",
    evidence: "trecho da conclusao em last.tex",
    file: "last.tex",
    startLine: 2,
    endLine: 5,
    sectionId: "sec-conclusao",
    manuscriptFingerprint: fp,
    batchId: b2,
  };

  function fullSinteseJson(overrides: Record<string, unknown> = {}) {
    return JSON.stringify({
      version: "global-analysis-synthesis-input-v1",
      planId: "p1",
      manuscriptFingerprint: fp,
      coverage: {
        state: "complete",
        totalBatches: 3,
        completedBatches: 3,
        totalCharacters: 300,
        completedCharacters: 300,
        coveragePercent: 100,
        orderedBatchIds: [b0, b1, b2],
      },
      findings: [findingPhase1, findingPhase2],
      ...overrides,
    });
  }

  /** Valid post-sintese global synthesis body (six sections + cross-batch relation). */
  function validGlobalReplyText(
    opts: {
      idA?: string;
      idB?: string;
      fileA?: string;
      fileB?: string;
      lineA?: string;
      lineB?: string;
      secA?: string;
      secB?: string;
      extra?: string;
    } = {}
  ): string {
    const idA = opts.idA ?? findingPhase1.findingId;
    const idB = opts.idB ?? findingPhase2.findingId;
    const fileA = opts.fileA ?? findingPhase1.file;
    const fileB = opts.fileB ?? findingPhase2.file;
    const lineA = opts.lineA ?? `${findingPhase1.startLine}-${findingPhase1.endLine}`;
    const lineB = opts.lineB ?? `${findingPhase2.startLine}-${findingPhase2.endLine}`;
    const secA = opts.secA ?? findingPhase1.sectionId;
    const secB = opts.secB ?? findingPhase2.sectionId;
    return [
      "## Síntese global do manuscrito",
      "O manuscrito sintético apresenta um arco objetivo–método–conclusão com tensão interna.",
      "",
      "## Contradições ou tensões entre seções",
      `Há tensão entre o objetivo e a conclusão: findingId=${idA} em ${fileA} linhas ${lineA} seção ${secA} afirma ganho de Alpha, enquanto findingId=${idB} em ${fileB} linhas ${lineB} seção ${secB} conclui ausência de melhoria. A relação entre esses findings de lotes distintos evidencia contradição argumentativa.`,
      "",
      "## Coerência entre objetivos, método, resultados e conclusão",
      "A coerência global é frágil porque a conclusão nega o objetivo declarado, sem reconciliar o método.",
      "",
      "## Lacunas globais de argumentação ou evidência",
      "Nenhum problema global comprovável adicional de lacuna foi identificado além da tensão já citada.",
      "",
      "## Redundâncias e inconsistências recorrentes",
      "Nenhuma redundância global comprovável foi identificada.",
      "",
      "## Prioridades de revisão",
      "Revisar a articulação entre objetivo e conclusão para eliminar a contradição.",
      opts.extra ?? "",
    ].join("\n");
  }

  const skillEvt = () =>
    oc("skill", {
      id: "s1",
      input: { name: "banca-avaliacao" },
      output: "# Skill: Banca Avaliação\nloaded",
    });

  function happyPhase1() {
    return [
      skillEvt(),
      oc("banca_context", { id: "c1", output: `context → ${pack1}` }),
      oc("read", { id: "r1", input: { filePath: pack1 }, output: "SECTION_FIRST" }),
      oc("banca_auditar", {
        id: "a1",
        input: {
          manuscriptFingerprint: fp,
          batchId: b0,
          findings: [{ file: "first.tex", category: "clarity", severity: "low" }],
        },
        output: JSON.stringify({ kind: "openbanca-audit-receipt-v2", acceptedCount: 1 }),
      }),
      oc("banca_context", {
        id: "c2",
        input: { completedBatchId: b0 },
        output: `context → ${pack2}`,
      }),
    ];
  }

  function happyPartial() {
    return [
      oc("banca_sintese", {
        id: "syn1",
        output:
          "synthesis input error\ncode=incomplete_coverage\nmessage=coverage incomplete",
      }),
    ];
  }

  function happyPhase2(opts: { globalReply?: string | null; sinteseOutput?: string } = {}) {
    const events: any[] = [
      oc("skill", {
        id: "s2",
        input: { name: "banca-avaliacao" },
        output: "# Skill: Banca Avaliação\nloaded",
      }),
      oc("banca_context", { id: "c3", output: `context → ${pack2}` }),
      oc("read", { id: "r2", input: { filePath: pack2 }, output: "SECTION_MIDDLE" }),
      oc("banca_auditar", {
        id: "a2",
        input: { manuscriptFingerprint: fp, batchId: b1, findings: [] },
        output: "{}",
      }),
      oc("banca_context", {
        id: "c4",
        input: { completedBatchId: b1 },
        output: `context → ${pack3}`,
      }),
      oc("read", { id: "r3", input: { filePath: pack3 }, output: "SECTION_LAST" }),
      oc("banca_auditar", {
        id: "a3",
        input: {
          manuscriptFingerprint: fp,
          batchId: b2,
          findings: [{ file: "last.tex", category: "coherence", severity: "high" }],
        },
        output: JSON.stringify({ kind: "openbanca-audit-receipt-v2", acceptedCount: 1 }),
      }),
      oc("banca_context", {
        id: "c5",
        input: { completedBatchId: b2 },
        output: `context → ${packDone}`,
      }),
      oc("read", { id: "r4", input: { filePath: packDone }, output: "complete" }),
      oc("banca_sintese", {
        id: "syn2",
        output: opts.sinteseOutput ?? fullSinteseJson(),
      }),
    ];
    if (opts.globalReply !== null) {
      events.push(ocText(opts.globalReply ?? validGlobalReplyText()));
    }
    return events;
  }

  function stateRunning(): ExhaustiveProjectState {
    return {
      findingsCount: 1,
      findingIds: ["fid-phase1"],
      findingsFingerprints: [fp],
      planIds: ["p1"],
      completedBatches: 1,
      totalBatches: 3,
      checkpointState: "running",
      manuscriptFingerprint: fp,
      contextPackPaths: [".banca/context/context-1.md"],
      sourcesInContextPacks: ["first.tex"],
      markersInContextPacks: { first: true, middle: false, last: false },
      inspectErrors: [],
    };
  }

  function stateComplete(): ExhaustiveProjectState {
    return {
      ...stateRunning(),
      completedBatches: 3,
      checkpointState: "complete",
      findingsCount: 2,
      findingIds: ["fid-phase1", "fid-phase2-last"],
      sourcesInContextPacks: ["first.tex", "middle.tex", "last.tex"],
      markersInContextPacks: { first: true, middle: true, last: true },
      contextPackPaths: [
        ".banca/context/context-1.md",
        ".banca/context/context-2.md",
        ".banca/context/context-3.md",
      ],
      inspectErrors: [],
    };
  }

  function evalOpts(partial: Parameters<typeof verifyExhaustiveProtocol>[0]) {
    return verifyExhaustiveProtocol({
      projectRoot,
      ...partial,
    });
  }

  test("extractContextPackPath and pathsMatchForRead require canonical context path", () => {
    expect(extractContextPackPath(`context → ${pack1}`)).toBe(pack1);
    // Exact absolute paths under projectRoot/.banca/context/
    expect(pathsMatchForRead(pack1, pack1, projectRoot)).toBe(true);
    expect(pathsMatchForRead(pack1, join(projectRoot, ".banca/context/context-1.md"), projectRoot)).toBe(
      true
    );
    // Same basename in a different directory must FAIL
    expect(
      pathsMatchForRead(pack1, "/other/place/.banca/context/context-1.md", projectRoot)
    ).toBe(false);
    // Basename-only / ambiguous suffix must FAIL
    expect(pathsMatchForRead(pack1, "context-1.md", projectRoot)).toBe(false);
    expect(pathsMatchForRead(pack1, "banca/context/context-1.md", projectRoot)).toBe(false);
    expect(pathsMatchForRead(pack1, pack2, projectRoot)).toBe(false);
  });

  test("isIncompleteCoverageRejection is strict; success needs full V1 contract", () => {
    const incomplete =
      "synthesis input error\ncode=incomplete_coverage\nmessage=coverage incomplete";
    expect(isIncompleteCoverageRejection(incomplete, "completed")).toBe(true);
    expect(isIncompleteCoverageRejection(incomplete, "error")).toBe(false);
    expect(
      isIncompleteCoverageRejection(
        "synthesis input error\ncode=missing_findings\nmessage=x",
        "completed"
      )
    ).toBe(false);
    expect(extractSinteseErrorCode(incomplete)).toBe("incomplete_coverage");
    expect(isSinteseErrorOutput(incomplete, null)).toBe(true);
    expect(isSinteseSuccessOutput(fullSinteseJson())).toBe(true);
    // version + planId alone is NOT enough
    expect(
      isSinteseSuccessOutput(
        JSON.stringify({
          version: "global-analysis-synthesis-input-v1",
          planId: "p",
          manuscriptFingerprint: "f",
        })
      )
    ).toBe(false);
    // incomplete coverage in coverage block
    expect(
      isSinteseSuccessOutput(
        fullSinteseJson({
          coverage: {
            state: "running",
            totalBatches: 3,
            completedBatches: 1,
            totalCharacters: 300,
            completedCharacters: 100,
            coveragePercent: 33,
            orderedBatchIds: [b0],
          },
        })
      )
    ).toBe(false);
  });

  test("isSinteseSuccessOutput rejects coveragePercent 100 with incomplete characters", () => {
    expect(
      isSinteseSuccessOutput(
        fullSinteseJson({
          coverage: {
            state: "complete",
            totalBatches: 3,
            completedBatches: 3,
            totalCharacters: 300,
            completedCharacters: 299,
            coveragePercent: 100,
            orderedBatchIds: [b0, b1, b2],
          },
        })
      )
    ).toBe(false);
  });

  test("isSinteseSuccessOutput rejects invalid AnalysisFinding shapes", () => {
    const validFinding = {
      version: "analysis-finding-v1",
      findingId: "fid-1",
      planId: "p1",
      category: "clarity",
      severity: "low",
      claim: "claim text",
      evidence: "evidence text",
      file: "first.tex",
      startLine: 1,
      endLine: 2,
      sectionId: "sec-1",
      manuscriptFingerprint: fp,
      batchId: b0,
    };
    expect(
      isMinimalAnalysisFindingShape(validFinding, {
        planId: "p1",
        manuscriptFingerprint: fp,
      })
    ).toBe(true);
    expect(isSinteseSuccessOutput(fullSinteseJson({ findings: [validFinding] }))).toBe(true);

    // missing version
    expect(
      isSinteseSuccessOutput(
        fullSinteseJson({
          findings: [{ ...validFinding, version: undefined }],
        })
      )
    ).toBe(false);
    // planId mismatch vs envelope
    expect(
      isSinteseSuccessOutput(
        fullSinteseJson({
          findings: [{ ...validFinding, planId: "other-plan" }],
        })
      )
    ).toBe(false);
    // fingerprint mismatch
    expect(
      isSinteseSuccessOutput(
        fullSinteseJson({
          findings: [{ ...validFinding, manuscriptFingerprint: "other-fp" }],
        })
      )
    ).toBe(false);
    // endLine < startLine
    expect(
      isSinteseSuccessOutput(
        fullSinteseJson({
          findings: [{ ...validFinding, startLine: 5, endLine: 2 }],
        })
      )
    ).toBe(false);
    // empty claim
    expect(
      isSinteseSuccessOutput(
        fullSinteseJson({
          findings: [{ ...validFinding, claim: "   " }],
        })
      )
    ).toBe(false);
    // non-positive line
    expect(
      isSinteseSuccessOutput(
        fullSinteseJson({
          findings: [{ ...validFinding, startLine: 0, endLine: 1 }],
        })
      )
    ).toBe(false);
  });

  test("writeSyntheticMultiBatchProject creates first/middle/last sources and config", () => {
    const root = mkdtempSync(join(tmpdir(), "e2e-multi-proj-"));
    try {
      const meta = writeSyntheticMultiBatchProject(root);
      expect(meta.maxCharactersPerBatch).toBeGreaterThan(0);
      expect(existsSync(join(root, "main.tex"))).toBe(true);
      expect(existsSync(join(root, "first.tex"))).toBe(true);
      expect(existsSync(join(root, "middle.tex"))).toBe(true);
      expect(existsSync(join(root, "last.tex"))).toBe(true);
      expect(existsSync(join(root, "referencias.bib"))).toBe(true);
      const cfg = JSON.parse(readFileSync(join(root, ".banca", "project.json"), "utf8"));
      expect(cfg.analysis.maxCharactersPerBatch).toBe(meta.maxCharactersPerBatch);
      expect(readFileSync(join(root, "first.tex"), "utf8")).toContain("SECTION_FIRST");
      expect(readFileSync(join(root, "middle.tex"), "utf8")).toContain("SECTION_MIDDLE");
      expect(readFileSync(join(root, "last.tex"), "utf8")).toContain("SECTION_LAST");
      const empty = inspectExhaustiveProjectState(root);
      expect(empty.findingsCount).toBe(0);
      expect(empty.completedBatches).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("valid multi-batch order with interrupt, resume, synthesis and global reply PASSes", () => {
    const phase1 = happyPhase1();
    const partial = happyPartial();
    const phase2 = happyPhase2();
    const evaluation = evalOpts({
      events: [...phase1, ...partial, ...phase2],
      phase1Events: phase1,
      partialSinteseEvents: partial,
      phase2Events: phase2,
      stateAfterPhase1: stateRunning(),
      stateAfterPhase2: stateComplete(),
      minBatches: 3,
      hashesMatch: true,
      resumeAcrossProcesses: true,
    });
    expect(evaluation.skillSucceeded).toBe(true);
    expect(evaluation.multiBatchOrderCorrect).toBe(true);
    expect(evaluation.readsSucceeded).toBe(true);
    expect(evaluation.minBatchesMet).toBe(true);
    expect(evaluation.batchesCompleted).toBeGreaterThanOrEqual(3);
    expect(evaluation.sameFingerprint).toBe(true);
    expect(evaluation.sourceCoverageOk).toBe(true);
    expect(evaluation.prematureSinteseAttempted).toBe(true);
    expect(evaluation.prematureSinteseRejected).toBe(true);
    expect(evaluation.finalSinteseSucceeded).toBe(true);
    expect(evaluation.findingsPersisted).toBe(true);
    expect(evaluation.findingsNotDuplicatedOnResume).toBe(true);
    expect(evaluation.phase1Interrupted).toBe(true);
    expect(evaluation.resumeAcrossProcesses).toBe(true);
    expect(evaluation.globalSynthesisOk).toBe(true);
    expect(evaluation.globalReplyPresent).toBe(true);
    expect(evaluation.globalReplyAfterSintese).toBe(true);
    expect(evaluation.globalSectionsOrdered).toBe(true);
    expect(evaluation.globalCrossBatchRelation).toBe(true);
    expect(evaluation.globalFindingIdsAllowlisted).toBe(true);
    expect(evaluation.globalForbiddenLanguageAbsent).toBe(true);
    expect(evaluation.globalNotJsonPassthrough).toBe(true);
    expect(evaluation.globalCitedBatchIds.length).toBeGreaterThanOrEqual(2);

    const classified = classifyProtocolPhase({
      hasAuthAndModel: true,
      initPassed: true,
      result: okResult("{}"),
      evaluation,
    });
    expect(classified.outcome).toBe("PASS");
    expect(classified.passed).toBe(true);
    expect(classified.classification).toBe("MODEL_PROTOCOL_PASSED");
  });

  test("wrong tool order fails multi-batch order", () => {
    const events = [
      skillEvt(),
      oc("banca_auditar", {
        id: "a1",
        input: { manuscriptFingerprint: fp, batchId: b0, findings: [] },
        output: "{}",
      }),
      oc("banca_context", { id: "c1", output: `context → ${pack1}` }),
    ];
    const evaluation = evalOpts({
      events,
      stateAfterPhase2: stateComplete(),
      resumeAcrossProcesses: true,
    });
    expect(evaluation.multiBatchOrderCorrect).toBe(false);
    expect(evaluation.readsSucceeded).toBe(false);
    expect(
      classifyProtocolPhase({
        hasAuthAndModel: true,
        initPassed: true,
        result: okResult("{}"),
        evaluation,
      }).outcome
    ).toBe("FAIL");
  });

  test("missing read of context pack path fails", () => {
    const events = [
      skillEvt(),
      oc("banca_context", { id: "c1", output: `context → ${pack1}` }),
      oc("banca_auditar", {
        id: "a1",
        input: { manuscriptFingerprint: fp, batchId: b0, findings: [] },
        output: "{}",
      }),
      oc("banca_context", {
        id: "c2",
        input: { completedBatchId: b0 },
        output: `context → ${pack2}`,
      }),
    ];
    const evaluation = evalOpts({
      events,
      stateAfterPhase2: stateComplete(),
      resumeAcrossProcesses: true,
    });
    expect(evaluation.readsSucceeded).toBe(false);
    expect(evaluation.multiBatchOrderCorrect).toBe(false);
  });

  test("premature successful banca_sintese is not rejected and fails classification", () => {
    const phase1 = happyPhase1();
    const partial = [
      oc("banca_sintese", {
        id: "syn-early",
        output: fullSinteseJson(),
      }),
    ];
    const phase2 = happyPhase2();
    const evaluation = evalOpts({
      events: [...phase1, ...partial, ...phase2],
      phase1Events: phase1,
      partialSinteseEvents: partial,
      phase2Events: phase2,
      stateAfterPhase1: stateRunning(),
      stateAfterPhase2: stateComplete(),
      resumeAcrossProcesses: true,
    });
    expect(evaluation.prematureSinteseAttempted).toBe(true);
    expect(evaluation.prematureSinteseRejected).toBe(false);
    expect(
      classifyProtocolPhase({
        hasAuthAndModel: true,
        initPassed: true,
        result: okResult("{}"),
        evaluation,
      }).classification
    ).toContain("premature_sintese_not_rejected");
  });

  test("partial synthesis tool_error status does not count as incomplete_coverage gate", () => {
    const phase1 = happyPhase1();
    const partial = [
      oc("banca_sintese", {
        id: "syn-err",
        status: "error",
        error: "tool failed",
        output: "synthesis input error\ncode=incomplete_coverage\nmessage=x",
      }),
    ];
    const evaluation = evalOpts({
      events: [...phase1, ...partial, ...happyPhase2()],
      phase1Events: phase1,
      partialSinteseEvents: partial,
      phase2Events: happyPhase2(),
      stateAfterPhase1: stateRunning(),
      stateAfterPhase2: stateComplete(),
      resumeAcrossProcesses: true,
    });
    expect(evaluation.prematureSinteseAttempted).toBe(true);
    expect(evaluation.prematureSinteseRejected).toBe(false);
  });

  test("partial synthesis with code other than incomplete_coverage fails gate", () => {
    const phase1 = happyPhase1();
    const partial = [
      oc("banca_sintese", {
        id: "syn-miss",
        output: "synthesis input error\ncode=missing_findings\nmessage=no store",
      }),
    ];
    const evaluation = evalOpts({
      events: [...phase1, ...partial, ...happyPhase2()],
      phase1Events: phase1,
      partialSinteseEvents: partial,
      phase2Events: happyPhase2(),
      stateAfterPhase1: stateRunning(),
      stateAfterPhase2: stateComplete(),
      resumeAcrossProcesses: true,
    });
    expect(evaluation.prematureSinteseAttempted).toBe(true);
    expect(evaluation.prematureSinteseRejected).toBe(false);
  });

  test("phase2 re-audit of phase1 batchId fails multi-batch order", () => {
    const phase1 = happyPhase1();
    const partial = happyPartial();
    // Phase2 re-audits b0 (already completed in phase1) then continues
    const phase2 = [
      oc("skill", {
        id: "s2",
        input: { name: "banca-avaliacao" },
        output: "# Skill: Banca Avaliação\nloaded",
      }),
      oc("banca_context", { id: "c3", output: `context → ${pack1}` }),
      oc("read", { id: "r2", input: { filePath: pack1 }, output: "SECTION_FIRST" }),
      oc("banca_auditar", {
        id: "a-re",
        input: { manuscriptFingerprint: fp, batchId: b0, findings: [] },
        output: "{}",
      }),
      oc("banca_context", {
        id: "c4",
        input: { completedBatchId: b0 },
        output: `context → ${pack2}`,
      }),
      oc("read", { id: "r3", input: { filePath: pack2 }, output: "SECTION_MIDDLE" }),
      oc("banca_auditar", {
        id: "a2",
        input: { manuscriptFingerprint: fp, batchId: b1, findings: [] },
        output: "{}",
      }),
      oc("banca_context", {
        id: "c5",
        input: { completedBatchId: b1 },
        output: `context → ${pack3}`,
      }),
      oc("read", { id: "r4", input: { filePath: pack3 }, output: "SECTION_LAST" }),
      oc("banca_auditar", {
        id: "a3",
        input: { manuscriptFingerprint: fp, batchId: b2, findings: [] },
        output: "{}",
      }),
      oc("banca_context", {
        id: "c6",
        input: { completedBatchId: b2 },
        output: `context → ${packDone}`,
      }),
      oc("read", { id: "r5", input: { filePath: packDone }, output: "complete" }),
      oc("banca_sintese", { id: "syn2", output: fullSinteseJson() }),
    ];
    const evaluation = evalOpts({
      events: [...phase1, ...partial, ...phase2],
      phase1Events: phase1,
      partialSinteseEvents: partial,
      phase2Events: phase2,
      stateAfterPhase1: stateRunning(),
      stateAfterPhase2: stateComplete(),
      resumeAcrossProcesses: true,
    });
    expect(evaluation.multiBatchOrderCorrect).toBe(false);
  });

  test("missing final successful banca_sintese fails", () => {
    const phase1 = happyPhase1();
    const partial = happyPartial();
    const phase2 = happyPhase2().filter((e) => {
      const n = normalizeToolEvent(e);
      return n?.tool !== "banca_sintese";
    });
    const evaluation = evalOpts({
      events: [...phase1, ...partial, ...phase2],
      phase1Events: phase1,
      partialSinteseEvents: partial,
      phase2Events: phase2,
      stateAfterPhase1: stateRunning(),
      stateAfterPhase2: stateComplete(),
      resumeAcrossProcesses: true,
    });
    expect(evaluation.finalSinteseSucceeded).toBe(false);
    expect(
      classifyProtocolPhase({
        hasAuthAndModel: true,
        initPassed: true,
        result: okResult("{}"),
        evaluation,
      }).classification
    ).toContain("final_sintese_missing");
  });

  test("divergent fingerprint across batches fails", () => {
    const events = [
      skillEvt(),
      oc("banca_context", { id: "c1", output: `context → ${pack1}` }),
      oc("read", { id: "r1", input: { filePath: pack1 }, output: "x" }),
      oc("banca_auditar", {
        id: "a1",
        input: { manuscriptFingerprint: "fp-one", batchId: b0, findings: [] },
        output: "{}",
      }),
      oc("banca_context", {
        id: "c2",
        input: { completedBatchId: b0 },
        output: `context → ${pack2}`,
      }),
      oc("read", { id: "r2", input: { filePath: pack2 }, output: "y" }),
      oc("banca_auditar", {
        id: "a2",
        input: { manuscriptFingerprint: "fp-two", batchId: b1, findings: [] },
        output: "{}",
      }),
      oc("banca_context", {
        id: "c3",
        input: { completedBatchId: b1 },
        output: `context → ${pack3}`,
      }),
    ];
    const evaluation = evalOpts({
      events,
      stateAfterPhase2: stateComplete(),
      resumeAcrossProcesses: true,
    });
    expect(evaluation.sameFingerprint).toBe(false);
    expect(
      classifyProtocolPhase({
        hasAuthAndModel: true,
        initPassed: true,
        result: okResult("{}"),
        evaluation,
      }).classification
    ).toContain("fingerprint_divergent");
  });

  test("resume duplication of findings is detected via repeated findingIds", () => {
    const phase1 = happyPhase1();
    const partial = happyPartial();
    const phase2 = happyPhase2();
    // Realistic resume: completedBatches advanced 1→3, but store listed the same
    // phase1 findingId twice (merge failed) → must FAIL dedup.
    const evaluation = evalOpts({
      events: [...phase1, ...partial, ...phase2],
      phase1Events: phase1,
      partialSinteseEvents: partial,
      phase2Events: phase2,
      stateAfterPhase1: {
        ...stateRunning(),
        findingsCount: 1,
        findingIds: ["fid-phase1"],
        completedBatches: 1,
      },
      stateAfterPhase2: {
        ...stateComplete(),
        findingsCount: 2,
        findingIds: ["fid-phase1", "fid-phase1"],
        completedBatches: 3,
      },
      resumeAcrossProcesses: true,
    });
    expect(evaluation.findingsNotDuplicatedOnResume).toBe(false);
  });

  test("disk-complete with skipped mid/last audit cycles must FAIL", () => {
    // Only batch-0 has full context→read→auditar→completedBatchId.
    // Batches 1 and 2 are "advanced" only via completedBatchId (no read/auditar).
    // Disk claims complete + final sintese succeeds — must still FAIL classification.
    const phase1 = happyPhase1();
    const partial = happyPartial();
    const phase2Skipped = [
      oc("skill", {
        id: "s2",
        input: { name: "banca-avaliacao" },
        output: "# Skill: Banca Avaliação\nloaded",
      }),
      // Illicit: mark batch-1 and batch-2 complete without auditing them
      oc("banca_context", {
        id: "c-skip-1",
        input: { completedBatchId: b1 },
        output: `context → ${pack3}`,
      }),
      oc("banca_context", {
        id: "c-skip-2",
        input: { completedBatchId: b2 },
        output: `context → ${packDone}`,
      }),
      oc("read", { id: "r-done", input: { filePath: packDone }, output: "complete" }),
      oc("banca_sintese", {
        id: "syn2",
        output: fullSinteseJson(),
      }),
    ];
    const evaluation = evalOpts({
      events: [...phase1, ...partial, ...phase2Skipped],
      phase1Events: phase1,
      partialSinteseEvents: partial,
      phase2Events: phase2Skipped,
      stateAfterPhase1: stateRunning(),
      stateAfterPhase2: {
        ...stateComplete(),
        completedBatches: 3,
        totalBatches: 3,
        checkpointState: "complete",
      },
      minBatches: 3,
      hashesMatch: true,
      resumeAcrossProcesses: true,
    });
    expect(evaluation.multiBatchOrderCorrect).toBe(false);
    expect(evaluation.minBatchesMet).toBe(false);
    expect(evaluation.batchesCompleted).toBe(1);
    expect(evaluation.finalSinteseSucceeded).toBe(false);

    const classified = classifyProtocolPhase({
      hasAuthAndModel: true,
      initPassed: true,
      result: okResult("{}"),
      evaluation,
    });
    expect(classified.outcome).toBe("FAIL");
    expect(classified.passed).toBe(false);
    expect(classified.classification).toMatch(
      /multi_batch_order_incorrect|min_batches_not_met|final_sintese_missing/
    );
  });

  test("pending or error tool status is never treated as success in tracks", () => {
    const events = [
      skillEvt(),
      oc("banca_context", {
        id: "c1",
        status: "running",
        output: `context → ${pack1}`,
      }),
      oc("read", { id: "r1", input: { filePath: pack1 }, output: "x" }),
      oc("banca_auditar", {
        id: "a1",
        status: "error",
        error: "boom",
        input: { manuscriptFingerprint: fp, batchId: b0, findings: [] },
        output: "partial",
      }),
    ];
    const evaluation = evalOpts({
      events,
      stateAfterPhase2: stateComplete(),
      resumeAcrossProcesses: true,
    });
    expect(evaluation.contextCalled).toBe(false);
    expect(evaluation.auditarCalled).toBe(false);
    expect(evaluation.multiBatchOrderCorrect).toBe(false);
  });

  test("synthetic manuscript embeds objective vs conclusion tension", () => {
    const root = mkdtempSync(join(tmpdir(), "e2e-tension-"));
    try {
      writeSyntheticMultiBatchProject(root);
      const first = readFileSync(join(root, "first.tex"), "utf8");
      const last = readFileSync(join(root, "last.tex"), "utf8");
      expect(first).toContain("objetivo");
      expect(first.toLowerCase()).toMatch(/melhora|ganho/);
      expect(last.toLowerCase()).toMatch(/n[aã]o produz|refut|descart/);
      expect(first).toContain("SECTION_FIRST");
      expect(last).toContain("SECTION_LAST");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // --- Issue #92: global synthesis after full coverage ---

  test("normalizeTextEvent accepts completed OpenCode text parts only", () => {
    const good = ocText("hello assistant");
    const n = normalizeTextEvent(good, 3);
    expect(n).not.toBeNull();
    expect(n!.text).toBe("hello assistant");
    expect(n!.index).toBe(3);
    expect(n!.malformed).toBeUndefined();
    expect(n!.sessionId).toBe("ses_test");

    // Incomplete stream (time without end) is not a final assistant reply
    expect(
      normalizeTextEvent({
        type: "text",
        sessionID: "ses_test",
        part: { type: "text", text: "partial", time: { start: 1 } },
      })
    ).toBeNull();

    // Missing part.time entirely is also incomplete (audit #93)
    expect(
      normalizeTextEvent({
        type: "text",
        sessionID: "ses_test",
        part: { type: "text", text: "no time object" },
      })
    ).toBeNull();
    expect(normalizeTextEvent(ocText("x", { omitTime: true }))).toBeNull();

    // Malformed: text event without part
    const mal = normalizeTextEvent({ type: "text" }, 0);
    expect(mal?.malformed).toBe(true);

    // Tool events are not text
    expect(normalizeTextEvent(oc("banca_sintese", { output: "{}" }))).toBeNull();

    // Non-assistant envelope
    expect(normalizeTextEvent({ type: "step_start", part: { type: "step-start" } })).toBeNull();
    expect(normalizeTextEvent(null)?.malformed).toBe(true);
    expect(normalizeAllTextEvents([good, oc("read", { output: "x" })]).length).toBe(1);
  });

  test("global reply missing after successful banca_sintese fails", () => {
    const phase1 = happyPhase1();
    const partial = happyPartial();
    const phase2 = happyPhase2({ globalReply: null });
    const evaluation = evalOpts({
      events: [...phase1, ...partial, ...phase2],
      phase1Events: phase1,
      partialSinteseEvents: partial,
      phase2Events: phase2,
      stateAfterPhase1: stateRunning(),
      stateAfterPhase2: stateComplete(),
      resumeAcrossProcesses: true,
    });
    expect(evaluation.finalSinteseSucceeded).toBe(true);
    expect(evaluation.globalReplyPresent).toBe(false);
    expect(evaluation.globalSynthesisOk).toBe(false);
    const classified = classifyProtocolPhase({
      hasAuthAndModel: true,
      initPassed: true,
      result: okResult("{}"),
      evaluation,
    });
    expect(classified.outcome).toBe("FAIL");
    expect(classified.classification).toContain("global_reply_missing");
  });

  test("global reply produced before banca_sintese fails", () => {
    const phase1 = happyPhase1();
    const partial = happyPartial();
    // Prepend global-looking text before tools; no text after sintese
    const phase2 = [
      ocText(validGlobalReplyText()),
      ...happyPhase2({ globalReply: null }),
    ];
    const evaluation = evalOpts({
      events: [...phase1, ...partial, ...phase2],
      phase1Events: phase1,
      partialSinteseEvents: partial,
      phase2Events: phase2,
      stateAfterPhase1: stateRunning(),
      stateAfterPhase2: stateComplete(),
      resumeAcrossProcesses: true,
    });
    expect(evaluation.finalSinteseSucceeded).toBe(true);
    expect(evaluation.globalSynthesisOk).toBe(false);
    expect(evaluation.globalReplyPresent).toBe(false);
    const classified = classifyProtocolPhase({
      hasAuthAndModel: true,
      initPassed: true,
      result: okResult("{}"),
      evaluation,
    });
    expect(classified.outcome).toBe("FAIL");
    expect(classified.classification).toMatch(/global_reply_missing|global_reply_before_sintese/);
  });

  test("missing or out-of-order global section fails", () => {
    const missingSection = validGlobalReplyText().replace(
      "## Coerência entre objetivos, método, resultados e conclusão\nA coerência global é frágil porque a conclusão nega o objetivo declarado, sem reconciliar o método.\n\n",
      ""
    );
    const reordered = [
      "## Prioridades de revisão",
      "x",
      "## Síntese global do manuscrito",
      "y",
      "## Contradições ou tensões entre seções",
      `tensão findingId=${findingPhase1.findingId} ${findingPhase1.file} ${findingPhase1.startLine}-${findingPhase1.endLine} ${findingPhase1.sectionId} e findingId=${findingPhase2.findingId} ${findingPhase2.file} ${findingPhase2.startLine}-${findingPhase2.endLine} ${findingPhase2.sectionId}`,
      "## Coerência entre objetivos, método, resultados e conclusão",
      "z",
      "## Lacunas globais de argumentação ou evidência",
      "n",
      "## Redundâncias e inconsistências recorrentes",
      "n",
    ].join("\n");

    expect(validateGlobalSectionOrder(missingSection).ok).toBe(false);
    expect(validateGlobalSectionOrder(reordered).ok).toBe(false);
    expect(validateGlobalSectionOrder(validGlobalReplyText()).ok).toBe(true);

    for (const bad of [missingSection, reordered]) {
      const phase1 = happyPhase1();
      const partial = happyPartial();
      const phase2 = happyPhase2({ globalReply: bad });
      const evaluation = evalOpts({
        events: [...phase1, ...partial, ...phase2],
        phase1Events: phase1,
        partialSinteseEvents: partial,
        phase2Events: phase2,
        stateAfterPhase1: stateRunning(),
        stateAfterPhase2: stateComplete(),
        resumeAcrossProcesses: true,
      });
      expect(evaluation.globalSectionsOrdered).toBe(false);
      expect(evaluation.globalSynthesisOk).toBe(false);
      expect(
        classifyProtocolPhase({
          hasAuthAndModel: true,
          initPassed: true,
          result: okResult("{}"),
          evaluation,
        }).classification
      ).toContain("global_sections_missing_or_unordered");
    }
  });

  test("invented findingId fails allowlist gate", () => {
    const bad = validGlobalReplyText({ idB: "fid-invented-xyz" });
    // Allowlist still has real ids; inventing an extra labeled id
    const withLabel =
      bad + "\nfindingId=fid-totally-fake-999 also cited without allowlist entry.\n";
    const phase1 = happyPhase1();
    const partial = happyPartial();
    const phase2 = happyPhase2({ globalReply: withLabel });
    const evaluation = evalOpts({
      events: [...phase1, ...partial, ...phase2],
      phase1Events: phase1,
      partialSinteseEvents: partial,
      phase2Events: phase2,
      stateAfterPhase1: stateRunning(),
      stateAfterPhase2: stateComplete(),
      resumeAcrossProcesses: true,
    });
    expect(evaluation.globalFindingIdsAllowlisted).toBe(false);
    expect(evaluation.globalSynthesisOk).toBe(false);
    expect(
      classifyProtocolPhase({
        hasAuthAndModel: true,
        initPassed: true,
        result: okResult("{}"),
        evaluation,
      }).classification
    ).toContain("global_finding_ids_not_allowlisted");
  });

  test("mere ID listing under six titles without relational conclusion fails", () => {
    // Six ordered headers + allowlisted IDs with full file/line/sectionId but no
    // relational body prose → must FAIL (not accept bare listing).
    const bareList = [
      "## Síntese global do manuscrito",
      "x",
      "## Contradições ou tensões entre seções",
      `findingId=${findingPhase1.findingId} ${findingPhase1.file} ${findingPhase1.startLine}-${findingPhase1.endLine} ${findingPhase1.sectionId}`,
      `findingId=${findingPhase2.findingId} ${findingPhase2.file} ${findingPhase2.startLine}-${findingPhase2.endLine} ${findingPhase2.sectionId}`,
      "## Coerência entre objetivos, método, resultados e conclusão",
      "x",
      "## Lacunas globais de argumentação ou evidência",
      "x",
      "## Redundâncias e inconsistências recorrentes",
      "x",
      "## Prioridades de revisão",
      "x",
    ].join("\n");

    // Title vocabulary alone must not count as relational conclusion.
    const stripped = stripGlobalSectionTitles(bareList);
    expect(stripped).not.toMatch(/Contradições ou tensões/i);
    expect(
      hasRelationalConclusion(bareList, [
        { findingId: findingPhase1.findingId, batchId: findingPhase1.batchId },
        { findingId: findingPhase2.findingId, batchId: findingPhase2.batchId },
      ])
    ).toBe(false);

    const allow = parseSinteseAllowlistFindings(fullSinteseJson())!;
    const cross = validateCrossBatchRelation(bareList, allow);
    expect(cross.ok).toBe(false);
    expect(cross.reason).toBe("no_relational_conclusion");
    // IDs and batches are present; failure is specifically the missing conclusion.
    expect(cross.citedFindingIds.length).toBeGreaterThanOrEqual(2);
    expect(cross.citedBatchIds.length).toBeGreaterThanOrEqual(2);

    const phase1 = happyPhase1();
    const partial = happyPartial();
    const phase2 = happyPhase2({ globalReply: bareList });
    const evaluation = evalOpts({
      events: [...phase1, ...partial, ...phase2],
      phase1Events: phase1,
      partialSinteseEvents: partial,
      phase2Events: phase2,
      stateAfterPhase1: stateRunning(),
      stateAfterPhase2: stateComplete(),
      resumeAcrossProcesses: true,
    });
    expect(evaluation.globalSectionsOrdered).toBe(true);
    expect(evaluation.globalCrossBatchRelation).toBe(false);
    expect(evaluation.globalSynthesisOk).toBe(false);
    expect(
      classifyProtocolPhase({
        hasAuthAndModel: true,
        initPassed: true,
        result: okResult("{}"),
        evaluation,
      }).classification
    ).toContain("global_cross_batch_relation_missing");
  });

  test("same-batch-only findingIds fail cross-batch relation", () => {
    const sameBatchSintese = fullSinteseJson({
      findings: [
        findingPhase1,
        {
          ...findingPhase2,
          findingId: "fid-same-batch",
          batchId: b0,
          file: "first.tex",
          sectionId: "sec-objetivos",
        },
      ],
    });
    const reply = validGlobalReplyText({
      idB: "fid-same-batch",
      fileB: "first.tex",
      secB: "sec-objetivos",
      lineB: "2-5",
    });
    const phase1 = happyPhase1();
    const partial = happyPartial();
    const phase2 = happyPhase2({ globalReply: reply, sinteseOutput: sameBatchSintese });
    const evaluation = evalOpts({
      events: [...phase1, ...partial, ...phase2],
      phase1Events: phase1,
      partialSinteseEvents: partial,
      phase2Events: phase2,
      stateAfterPhase1: stateRunning(),
      stateAfterPhase2: stateComplete(),
      resumeAcrossProcesses: true,
    });
    expect(evaluation.globalCrossBatchRelation).toBe(false);
    expect(evaluation.globalSynthesisOk).toBe(false);
    expect(
      classifyProtocolPhase({
        hasAuthAndModel: true,
        initPassed: true,
        result: okResult("{}"),
        evaluation,
      }).classification
    ).toContain("global_cross_batch_relation_missing");
  });

  test("forbidden score/approval language fails", () => {
    const bad = validGlobalReplyText({
      extra: "\nA nota final seria 7 e a aprovação institucional é recomendada.\n",
    });
    expect(findForbiddenSynthesisLanguage(bad).length).toBeGreaterThan(0);
    const phase1 = happyPhase1();
    const partial = happyPartial();
    const phase2 = happyPhase2({ globalReply: bad });
    const evaluation = evalOpts({
      events: [...phase1, ...partial, ...phase2],
      phase1Events: phase1,
      partialSinteseEvents: partial,
      phase2Events: phase2,
      stateAfterPhase1: stateRunning(),
      stateAfterPhase2: stateComplete(),
      resumeAcrossProcesses: true,
    });
    expect(evaluation.globalForbiddenLanguageAbsent).toBe(false);
    expect(evaluation.globalForbiddenTermsFound.length).toBeGreaterThan(0);
    expect(evaluation.globalSynthesisOk).toBe(false);
    expect(
      classifyProtocolPhase({
        hasAuthAndModel: true,
        initPassed: true,
        result: okResult("{}"),
        evaluation,
      }).classification
    ).toContain("global_forbidden_language");
  });

  test("successful tool followed only by JSON pass-through fails", () => {
    const body = fullSinteseJson();
    expect(isJsonPassthroughReply(body)).toBe(true);
    expect(isJsonPassthroughReply("```json\n" + body + "\n```")).toBe(true);

    const phase1 = happyPhase1();
    const partial = happyPartial();
    const phase2 = happyPhase2({ globalReply: body });
    const evaluation = evalOpts({
      events: [...phase1, ...partial, ...phase2],
      phase1Events: phase1,
      partialSinteseEvents: partial,
      phase2Events: phase2,
      stateAfterPhase1: stateRunning(),
      stateAfterPhase2: stateComplete(),
      resumeAcrossProcesses: true,
    });
    expect(evaluation.globalNotJsonPassthrough).toBe(false);
    expect(evaluation.globalSynthesisOk).toBe(false);
    expect(
      classifyProtocolPhase({
        hasAuthAndModel: true,
        initPassed: true,
        result: okResult("{}"),
        evaluation,
      }).classification
    ).toMatch(/global_json_passthrough_only|global_sections_missing/);
  });

  test("malformed or non-assistant text events do not count as global reply", () => {
    const phase1 = happyPhase1();
    const partial = happyPartial();
    const phase2Base = happyPhase2({ globalReply: null });
    const phase2 = [
      ...phase2Base,
      // malformed text event
      { type: "text", part: { type: "text" } },
      // tool_use mislabeled
      {
        type: "text",
        part: {
          type: "tool",
          tool: "banca_sintese",
          state: { status: "completed", output: "nope" },
        },
      },
      // reasoning is not assistant final reply
      {
        type: "reasoning",
        part: { type: "reasoning", text: validGlobalReplyText(), time: { end: 1 } },
      },
      // plain string / null
      null,
      "not-an-event",
    ];
    const g = evaluateGlobalSynthesis(phase2);
    expect(g.globalReplyPresent).toBe(false);
    expect(g.globalSynthesisOk).toBe(false);

    const evaluation = evalOpts({
      events: [...phase1, ...partial, ...phase2],
      phase1Events: phase1,
      partialSinteseEvents: partial,
      phase2Events: phase2,
      stateAfterPhase1: stateRunning(),
      stateAfterPhase2: stateComplete(),
      resumeAcrossProcesses: true,
    });
    expect(evaluation.globalSynthesisOk).toBe(false);
    expect(
      classifyProtocolPhase({
        hasAuthAndModel: true,
        initPassed: true,
        result: okResult("{}"),
        evaluation,
      }).outcome
    ).toBe("FAIL");
  });

  test("evaluateGlobalSynthesis and allowlist helpers on pure fixtures", () => {
    const sinteseOut = fullSinteseJson();
    const allow = parseSinteseAllowlistFindings(sinteseOut);
    expect(allow).not.toBeNull();
    expect(allow!.length).toBe(2);
    expect(extractCitedFindingIds(validGlobalReplyText(), allow!).sort()).toEqual(
      ["fid-phase1", "fid-phase2-last"].sort()
    );
    expect(extractInventedFindingIds("findingId=fid-nope", allow!).length).toBe(1);
    const cross = validateCrossBatchRelation(validGlobalReplyText(), allow!);
    expect(cross.ok).toBe(true);
    expect(cross.citedBatchIds.sort()).toEqual([b0, b2].sort());

    const events = [
      oc("banca_sintese", { id: "s", output: sinteseOut }),
      ocText(validGlobalReplyText()),
    ];
    const g = evaluateGlobalSynthesis(events);
    expect(g.globalSynthesisOk).toBe(true);
    expect(g.globalSinteseEventIndex).toBe(0);
    expect(g.globalReplyEventIndex).toBe(1);
    expect(g.globalSectionsFound.length).toBe(6);
  });

  test("phase-final prompt reloads skill without pasting six section titles", () => {
    // Evaluator may list titles for validation; the phase-final *prompt* must not paste them.
    const phase2PromptBlock = runnerSource.match(
      /const promptPhase2\s*=\s*([\s\S]*?);[\r\n]/
    );
    expect(phase2PromptBlock).not.toBeNull();
    const promptSrc = phase2PromptBlock![0];
    for (const title of GLOBAL_SYNTHESIS_SECTIONS) {
      expect(promptSrc.includes(title)).toBe(false);
    }
    expect(promptSrc).toContain("banca-avaliacao");
    expect(promptSrc).toMatch(/reload it in this process/i);
    expect(promptSrc).toMatch(/global academic synthesis/i);
    expect(promptSrc).toMatch(/Do not merely pass through/i);
  });

  // --- Issue #93: fail-closed false-positive hardenings ---

  test("text envelope without part.time.end is rejected as global reply", () => {
    const phase1 = happyPhase1();
    const partial = happyPartial();
    const phase2Base = happyPhase2({ globalReply: null });
    // Incomplete text after successful sintese (no part.time at all)
    const incomplete = {
      type: "text",
      sessionID: "ses_test",
      part: { type: "text", text: validGlobalReplyText() },
    };
    const phase2 = [...phase2Base, incomplete];
    const evaluation = evalOpts({
      events: [...phase1, ...partial, ...phase2],
      phase1Events: phase1,
      partialSinteseEvents: partial,
      phase2Events: phase2,
      stateAfterPhase1: stateRunning(),
      stateAfterPhase2: stateComplete(),
      resumeAcrossProcesses: true,
    });
    expect(evaluation.finalSinteseSucceeded).toBe(true);
    expect(evaluation.globalReplyPresent).toBe(false);
    expect(evaluation.globalSynthesisOk).toBe(false);
    expect(
      classifyProtocolPhase({
        hasAuthAndModel: true,
        initPassed: true,
        result: okResult("{}"),
        evaluation,
      }).classification
    ).toContain("global_reply_missing");
  });

  test("duplicated section title fails uniqueness even if ordered subsequence exists", () => {
    const withDup = [
      "## Síntese global do manuscrito",
      "intro",
      // Extra early copy of a later title — ordered pass can still find six in order later
      "## Prioridades de revisão",
      "premature priorities",
      "## Contradições ou tensões entre seções",
      `Há tensão: findingId=${findingPhase1.findingId} em ${findingPhase1.file} linhas ${findingPhase1.startLine}-${findingPhase1.endLine} seção ${findingPhase1.sectionId} e findingId=${findingPhase2.findingId} em ${findingPhase2.file} linhas ${findingPhase2.startLine}-${findingPhase2.endLine} seção ${findingPhase2.sectionId}.`,
      "## Coerência entre objetivos, método, resultados e conclusão",
      "coerência frágil",
      "## Lacunas globais de argumentação ou evidência",
      "nenhuma",
      "## Redundâncias e inconsistências recorrentes",
      "nenhuma",
      "## Prioridades de revisão",
      "revisar objetivo vs conclusão",
    ].join("\n");
    const sections = validateGlobalSectionOrder(withDup);
    expect(sections.orderOk).toBe(true);
    expect(sections.uniqueOk).toBe(false);
    expect(sections.ok).toBe(false);

    const phase1 = happyPhase1();
    const partial = happyPartial();
    const phase2 = happyPhase2({ globalReply: withDup });
    const evaluation = evalOpts({
      events: [...phase1, ...partial, ...phase2],
      phase1Events: phase1,
      partialSinteseEvents: partial,
      phase2Events: phase2,
      stateAfterPhase1: stateRunning(),
      stateAfterPhase2: stateComplete(),
      resumeAcrossProcesses: true,
    });
    expect(evaluation.globalSectionsOrdered).toBe(false);
    expect(evaluation.globalSynthesisOk).toBe(false);
    expect(
      classifyProtocolPhase({
        hasAuthAndModel: true,
        initPassed: true,
        result: okResult("{}"),
        evaluation,
      }).classification
    ).toContain("global_sections_missing_or_unordered");
  });

  test("bare non-allowlist SHA-256 hex findingId fails invent scan", () => {
    const realA = "a".repeat(64);
    const realB = "b".repeat(64);
    const inventedHex = "c".repeat(64);
    const allowFindings = [
      { ...findingPhase1, findingId: realA },
      { ...findingPhase2, findingId: realB },
    ];
    const sinteseOut = fullSinteseJson({ findings: allowFindings });
    // Body cites allowlisted IDs with provenance + a bare invented SHA-256 (no label)
    const reply = [
      "## Síntese global do manuscrito",
      "síntese",
      "## Contradições ou tensões entre seções",
      `Há tensão entre findings: findingId=${realA} em first.tex linhas 2-4 seção sec-objetivos e findingId=${realB} em last.tex linhas 2-5 seção sec-conclusao. Também ${inventedHex} aparece no texto.`,
      "## Coerência entre objetivos, método, resultados e conclusão",
      "coerência",
      "## Lacunas globais de argumentação ou evidência",
      "nenhuma",
      "## Redundâncias e inconsistências recorrentes",
      "nenhuma",
      "## Prioridades de revisão",
      "revisar",
    ].join("\n");

    const invented = extractInventedFindingIds(
      reply,
      parseSinteseAllowlistFindings(sinteseOut)!
    );
    expect(invented).toContain(inventedHex);

    const phase1 = happyPhase1();
    const partial = happyPartial();
    const phase2 = happyPhase2({ globalReply: reply, sinteseOutput: sinteseOut });
    const evaluation = evalOpts({
      events: [...phase1, ...partial, ...phase2],
      phase1Events: phase1,
      partialSinteseEvents: partial,
      phase2Events: phase2,
      stateAfterPhase1: stateRunning(),
      stateAfterPhase2: {
        ...stateComplete(),
        findingIds: [realA, realB],
      },
      resumeAcrossProcesses: true,
    });
    expect(evaluation.globalFindingIdsAllowlisted).toBe(false);
    expect(evaluation.globalSynthesisOk).toBe(false);
    expect(
      classifyProtocolPhase({
        hasAuthAndModel: true,
        initPassed: true,
        result: okResult("{}"),
        evaluation,
      }).classification
    ).toContain("global_finding_ids_not_allowlisted");
  });

  test("line digits only outside the finding window fail provenance", () => {
    // Section numbers "2." and "4." elsewhere must not satisfy line provenance for the finding.
    const f = {
      findingId: "fid-window-a",
      batchId: b0,
      file: "first.tex",
      startLine: 2,
      endLine: 4,
      sectionId: "sec-objetivos",
      claim: "c",
      evidence: "e",
    };
    const g = {
      findingId: "fid-window-b",
      batchId: b2,
      file: "last.tex",
      startLine: 2,
      endLine: 5,
      sectionId: "sec-conclusao",
      claim: "c",
      evidence: "e",
    };
    // Digits 2 and 4 appear only as markdown headers far from the findingId blocks
    const text = [
      "2. Header two",
      "4. Header four",
      "some date 2024",
      `findingId=${f.findingId} file=${f.file} sectionId=${f.sectionId}`,
      // no line range near this finding
      `findingId=${g.findingId} file=${g.file} sectionId=${g.sectionId}`,
    ].join("\n");
    expect(findingTraceableInText(text, f)).toBe(false);
    expect(findingTraceableInText(text, g)).toBe(false);
    // Windowed line helper: digits alone without line keyword fail
    expect(linesCitedInFindingWindow("2. Header\n4. other", 2, 4)).toBe(false);
    expect(linesCitedInFindingWindow("linhas 2-4", 2, 4)).toBe(true);

    const allow = [
      { ...f },
      { ...g },
    ];
    const cross = validateCrossBatchRelation(
      [
        "## Síntese global do manuscrito",
        "x",
        "## Contradições ou tensões entre seções",
        `Há tensão entre findingId=${f.findingId} ${f.file} ${f.sectionId} e findingId=${g.findingId} ${g.file} ${g.sectionId}`,
        // line digits only as section numbers above, not near findings
        "## Coerência entre objetivos, método, resultados e conclusão",
        "x",
        "## Lacunas globais de argumentação ou evidência",
        "x",
        "## Redundâncias e inconsistências recorrentes",
        "x",
        "## Prioridades de revisão",
        "x",
      ].join("\n"),
      allow
    );
    expect(cross.ok).toBe(false);
    expect(cross.reason).toBe("missing_file_line_section_traceability");
  });

  test("cross-session text after banca_sintese does not count as global reply", () => {
    expect(sessionsCorrelate("ses_a", "ses_b")).toBe(false);
    expect(sessionsCorrelate("ses_a", "ses_a")).toBe(true);
    // Missing either side does not prove same session (fail-closed)
    expect(sessionsCorrelate(null, "ses_a")).toBe(false);
    expect(sessionsCorrelate("ses_a", null)).toBe(false);
    expect(sessionsCorrelate(null, null)).toBe(false);
    expect(sessionsCorrelate("", "ses_a")).toBe(false);

    const phase1 = happyPhase1();
    const partial = happyPartial();
    // phase2 tools on ses_A; global text on ses_B
    const phase2Tools = happyPhase2({ globalReply: null }).map((e) => {
      if (e && typeof e === "object") {
        return { ...e, sessionID: "ses_A" };
      }
      return e;
    });
    const foreignText = ocText(validGlobalReplyText(), { sessionID: "ses_B" });
    const phase2 = [...phase2Tools, foreignText];
    const evaluation = evalOpts({
      events: [...phase1, ...partial, ...phase2],
      phase1Events: phase1,
      partialSinteseEvents: partial,
      phase2Events: phase2,
      stateAfterPhase1: stateRunning(),
      stateAfterPhase2: stateComplete(),
      resumeAcrossProcesses: true,
    });
    expect(evaluation.finalSinteseSucceeded).toBe(true);
    expect(evaluation.globalReplyPresent).toBe(false);
    expect(evaluation.globalSynthesisOk).toBe(false);
    // Pure evaluateGlobalSynthesis on mixed-session stream
    const g = evaluateGlobalSynthesis(phase2);
    expect(g.globalSynthesisOk).toBe(false);
    expect(g.globalReplyPresent).toBe(false);
  });

  test("missing sessionId on tool or text fails same-session correlation", () => {
    const phase1 = happyPhase1();
    const partial = happyPartial();
    // Tools with session; text without sessionID field
    const phase2Tools = happyPhase2({ globalReply: null });
    const textNoSession = {
      type: "text",
      timestamp: Date.now(),
      // no sessionID
      part: {
        id: "prt_nosess",
        type: "text",
        text: validGlobalReplyText(),
        time: { start: 1, end: 2 },
      },
    };
    const phase2 = [...phase2Tools, textNoSession];
    const g = evaluateGlobalSynthesis(phase2);
    expect(g.globalReplyPresent).toBe(false);
    expect(g.globalSynthesisOk).toBe(false);

    // Tool without session, text with session
    const sinteseNoSess = {
      type: "tool_use",
      // no sessionID
      part: {
        type: "tool",
        tool: "banca_sintese",
        callID: "syn_nosess",
        state: { status: "completed", input: {}, output: fullSinteseJson() },
      },
    };
    const g2 = evaluateGlobalSynthesis([
      sinteseNoSess,
      ocText(validGlobalReplyText(), { sessionID: "ses_only_text" }),
    ]);
    expect(g2.globalReplyPresent).toBe(false);
    expect(g2.globalSynthesisOk).toBe(false);

    const evaluation = evalOpts({
      events: [...phase1, ...partial, ...phase2],
      phase1Events: phase1,
      partialSinteseEvents: partial,
      phase2Events: phase2,
      stateAfterPhase1: stateRunning(),
      stateAfterPhase2: stateComplete(),
      resumeAcrossProcesses: true,
    });
    expect(evaluation.globalSynthesisOk).toBe(false);
    expect(
      classifyProtocolPhase({
        hasAuthAndModel: true,
        initPassed: true,
        result: okResult("{}"),
        evaluation,
      }).classification
    ).toContain("global_reply_missing");
  });

  test("lone startLine label does not prove multi-line finding range", () => {
    // Finding spans lines 2-4; only startLine=2 must FAIL
    expect(linesCitedInFindingWindow("startLine=2", 2, 4)).toBe(false);
    expect(linesCitedInFindingWindow("startLine=2 endLine=4", 2, 4)).toBe(true);
    expect(linesCitedInFindingWindow("linhas 2-4", 2, 4)).toBe(true);
    expect(linesCitedInFindingWindow("linha 2", 2, 2)).toBe(true);
    expect(linesCitedInFindingWindow("startLine=2", 2, 2)).toBe(true);

    const f = {
      findingId: "fid-range-a",
      batchId: b0,
      file: "first.tex",
      startLine: 2,
      endLine: 4,
      sectionId: "sec-objetivos",
      claim: "c",
      evidence: "e",
    };
    const g = {
      findingId: "fid-range-b",
      batchId: b2,
      file: "last.tex",
      startLine: 2,
      endLine: 5,
      sectionId: "sec-conclusao",
      claim: "c",
      evidence: "e",
    };
    // Only startLine near each finding — not full range
    const reply = [
      "## Síntese global do manuscrito",
      "síntese",
      "## Contradições ou tensões entre seções",
      `Há tensão entre findingId=${f.findingId} ${f.file} sectionId=${f.sectionId} startLine=${f.startLine} e findingId=${g.findingId} ${g.file} sectionId=${g.sectionId} startLine=${g.startLine}.`,
      "## Coerência entre objetivos, método, resultados e conclusão",
      "x",
      "## Lacunas globais de argumentação ou evidência",
      "x",
      "## Redundâncias e inconsistências recorrentes",
      "x",
      "## Prioridades de revisão",
      "x",
    ].join("\n");
    expect(findingTraceableInText(reply, f)).toBe(false);
    expect(findingTraceableInText(reply, g)).toBe(false);
    const cross = validateCrossBatchRelation(reply, [f, g]);
    expect(cross.ok).toBe(false);
    expect(cross.reason).toBe("missing_file_line_section_traceability");
  });

  test("labeled findingId=fingerprint is invented even if envelope allows bare fingerprint", () => {
    const realA = "a".repeat(64);
    const realB = "b".repeat(64);
    const fingerprint = "d".repeat(64);
    const allowFindings = [
      {
        ...findingPhase1,
        findingId: realA,
        manuscriptFingerprint: fingerprint,
      },
      {
        ...findingPhase2,
        findingId: realB,
        manuscriptFingerprint: fingerprint,
      },
    ];
    // Envelope with fingerprint as manuscriptFingerprint (valid V1)
    const sinteseOut = fullSinteseJson({
      manuscriptFingerprint: fingerprint,
      findings: allowFindings.map((f) => ({
        ...f,
        manuscriptFingerprint: fingerprint,
      })),
    });
    // Bare fingerprint may be noise; labeled findingId=<fingerprint> must FAIL
    const reply = [
      "## Síntese global do manuscrito",
      "síntese",
      "## Contradições ou tensões entre seções",
      `Há tensão: findingId=${realA} em first.tex linhas 2-4 seção sec-objetivos e findingId=${realB} em last.tex linhas 2-5 seção sec-conclusao. Mas findingId=${fingerprint} não é um finding.`,
      "## Coerência entre objetivos, método, resultados e conclusão",
      "coerência",
      "## Lacunas globais de argumentação ou evidência",
      "nenhuma",
      "## Redundâncias e inconsistências recorrentes",
      "nenhuma",
      "## Prioridades de revisão",
      "revisar",
    ].join("\n");

    const allow = parseSinteseAllowlistFindings(sinteseOut)!;
    const extras = extractSinteseEnvelopeAllowedIds(sinteseOut);
    expect(extras).toContain(fingerprint);
    // Bare fingerprint alone would be allowed via extras; labeled is not
    expect(
      extractInventedFindingIds(`noise ${fingerprint} only`, allow, extras)
    ).toEqual([]);
    const invented = extractInventedFindingIds(reply, allow, extras);
    expect(invented).toContain(fingerprint);

    const phase1 = happyPhase1();
    const partial = happyPartial();
    const phase2 = happyPhase2({ globalReply: reply, sinteseOutput: sinteseOut });
    const evaluation = evalOpts({
      events: [...phase1, ...partial, ...phase2],
      phase1Events: phase1,
      partialSinteseEvents: partial,
      phase2Events: phase2,
      stateAfterPhase1: stateRunning(),
      stateAfterPhase2: {
        ...stateComplete(),
        findingIds: [realA, realB],
        manuscriptFingerprint: fingerprint,
      },
      resumeAcrossProcesses: true,
    });
    expect(evaluation.globalFindingIdsAllowlisted).toBe(false);
    expect(evaluation.globalSynthesisOk).toBe(false);
    expect(
      classifyProtocolPhase({
        hasAuthAndModel: true,
        initPassed: true,
        result: okResult("{}"),
        evaluation,
      }).classification
    ).toContain("global_finding_ids_not_allowlisted");
  });

  // --- Issue #93 residual: adjacent title uniqueness + exact provenance ---

  /** Six mandatory titles in order (optionally with a prefix line duplicated). */
  function sixTitlesBody(opts: {
    lines: string[];
    joinWith?: string;
  }): string {
    return opts.lines.join(opts.joinWith ?? "\n");
  }

  function assertAdjacentDupRejected(body: string) {
    const sections = validateGlobalSectionOrder(body);
    expect(sections.uniqueOk).toBe(false);
    expect(sections.ok).toBe(false);

    const phase1 = happyPhase1();
    const partial = happyPartial();
    // Keep relational prose valid so failure is specifically uniqueness
    const withRelation = body.includes("findingId=")
      ? body
      : body.replace(
          /Prioridades de revisão/,
          `Prioridades de revisão\nHá tensão entre findingId=${findingPhase1.findingId} em ${findingPhase1.file} linhas ${findingPhase1.startLine}-${findingPhase1.endLine} seção ${findingPhase1.sectionId} e findingId=${findingPhase2.findingId} em ${findingPhase2.file} linhas ${findingPhase2.startLine}-${findingPhase2.endLine} seção ${findingPhase2.sectionId}.`
        );
    const phase2 = happyPhase2({ globalReply: withRelation });
    const evaluation = evalOpts({
      events: [...phase1, ...partial, ...phase2],
      phase1Events: phase1,
      partialSinteseEvents: partial,
      phase2Events: phase2,
      stateAfterPhase1: stateRunning(),
      stateAfterPhase2: stateComplete(),
      resumeAcrossProcesses: true,
    });
    expect(evaluation.globalSectionsOrdered).toBe(false);
    expect(evaluation.globalSynthesisOk).toBe(false);
    const classified = classifyProtocolPhase({
      hasAuthAndModel: true,
      initPassed: true,
      result: okResult("{}"),
      evaluation,
    });
    expect(classified.outcome).toBe("FAIL");
    expect(classified.classification).toContain("global_sections_missing_or_unordered");
  }

  test("adjacent duplicate first title fails uniqueness", () => {
    const body = sixTitlesBody({
      lines: [
        "## Síntese global do manuscrito",
        "## Síntese global do manuscrito",
        "## Contradições ou tensões entre seções",
        "## Coerência entre objetivos, método, resultados e conclusão",
        "## Lacunas globais de argumentação ou evidência",
        "## Redundâncias e inconsistências recorrentes",
        "## Prioridades de revisão",
      ],
    });
    const sections = validateGlobalSectionOrder(body);
    expect(sections.uniqueOk).toBe(false);
    expect(sections.ok).toBe(false);
    assertAdjacentDupRejected(body);
  });

  test("adjacent duplicate intermediate title fails uniqueness", () => {
    const body = sixTitlesBody({
      lines: [
        "## Síntese global do manuscrito",
        "## Contradições ou tensões entre seções",
        "## Coerência entre objetivos, método, resultados e conclusão",
        "## Coerência entre objetivos, método, resultados e conclusão",
        "## Lacunas globais de argumentação ou evidência",
        "## Redundâncias e inconsistências recorrentes",
        "## Prioridades de revisão",
      ],
    });
    const sections = validateGlobalSectionOrder(body);
    expect(sections.uniqueOk).toBe(false);
    expect(sections.ok).toBe(false);
    assertAdjacentDupRejected(body);
  });

  test("adjacent duplicate Markdown headings fail uniqueness", () => {
    const body = sixTitlesBody({
      lines: [
        "### Síntese global do manuscrito",
        "### Síntese global do manuscrito",
        "#### Contradições ou tensões entre seções",
        "##### Coerência entre objetivos, método, resultados e conclusão",
        "###### Lacunas globais de argumentação ou evidência",
        "# Redundâncias e inconsistências recorrentes",
        "## Prioridades de revisão",
      ],
    });
    expect(validateGlobalSectionOrder(body).uniqueOk).toBe(false);
    expect(validateGlobalSectionOrder(body).ok).toBe(false);
    assertAdjacentDupRejected(body);
  });

  test("adjacent duplicate bold titles fail uniqueness", () => {
    const body = sixTitlesBody({
      lines: [
        "**Síntese global do manuscrito**",
        "**Síntese global do manuscrito**",
        "**Contradições ou tensões entre seções**",
        "__Coerência entre objetivos, método, resultados e conclusão__",
        "**Lacunas globais de argumentação ou evidência**",
        "**Redundâncias e inconsistências recorrentes**",
        "**Prioridades de revisão**",
      ],
    });
    expect(validateGlobalSectionOrder(body).uniqueOk).toBe(false);
    expect(validateGlobalSectionOrder(body).ok).toBe(false);
    assertAdjacentDupRejected(body);
  });

  test("adjacent duplicate titles with CRLF line endings fail uniqueness", () => {
    const body = sixTitlesBody({
      lines: [
        "## Síntese global do manuscrito",
        "## Síntese global do manuscrito",
        "## Contradições ou tensões entre seções",
        "## Coerência entre objetivos, método, resultados e conclusão",
        "## Lacunas globais de argumentação ou evidência",
        "## Redundâncias e inconsistências recorrentes",
        "## Prioridades de revisão",
      ],
      joinWith: "\r\n",
    });
    expect(body.includes("\r\n")).toBe(true);
    const sections = validateGlobalSectionOrder(body);
    expect(sections.uniqueOk).toBe(false);
    expect(sections.ok).toBe(false);
    assertAdjacentDupRejected(body);
  });

  test("sectionId partial match sec-10 does not satisfy expected sec-1", () => {
    const f = {
      findingId: "fid-sec-partial-a",
      batchId: b0,
      file: "chapters/intro.tex",
      startLine: 2,
      endLine: 4,
      sectionId: "sec-1",
      claim: "c",
      evidence: "e",
    };
    const g = {
      findingId: "fid-sec-partial-b",
      batchId: b2,
      file: "chapters/conclusion.tex",
      startLine: 2,
      endLine: 5,
      sectionId: "sec-2",
      claim: "c",
      evidence: "e",
    };
    // Cites sec-10 / sec-20 which contain sec-1 / sec-2 as substrings
    const text = [
      `findingId=${f.findingId} file=${f.file} linhas ${f.startLine}-${f.endLine} sectionId=sec-10`,
      `findingId=${g.findingId} file=${g.file} linhas ${g.startLine}-${g.endLine} sectionId=sec-20`,
    ].join("\n");
    expect(sectionIdCitedInWindow(text, "sec-1")).toBe(false);
    expect(sectionIdCitedInWindow("sectionId=sec-10", "sec-1")).toBe(false);
    expect(findingTraceableInText(text, f)).toBe(false);
    expect(findingTraceableInText(text, g)).toBe(false);

    const reply = [
      "## Síntese global do manuscrito",
      "síntese",
      "## Contradições ou tensões entre seções",
      `Há tensão entre findingId=${f.findingId} ${f.file} linhas ${f.startLine}-${f.endLine} sectionId=sec-10 e findingId=${g.findingId} ${g.file} linhas ${g.startLine}-${g.endLine} sectionId=sec-20.`,
      "## Coerência entre objetivos, método, resultados e conclusão",
      "x",
      "## Lacunas globais de argumentação ou evidência",
      "x",
      "## Redundâncias e inconsistências recorrentes",
      "x",
      "## Prioridades de revisão",
      "x",
    ].join("\n");
    const cross = validateCrossBatchRelation(reply, [f, g]);
    expect(cross.ok).toBe(false);
    expect(cross.reason).toBe("missing_file_line_section_traceability");
    const gEval = evaluateGlobalSynthesis([
      oc("banca_sintese", {
        id: "s",
        output: fullSinteseJson({ findings: [f, g] }),
      }),
      ocText(reply),
    ]);
    expect(gEval.globalCrossBatchRelation).toBe(false);
    expect(gEval.globalSynthesisOk).toBe(false);
  });

  test("sectionId prefix-sec-1 does not satisfy expected sec-1", () => {
    const f = {
      findingId: "fid-sec-prefix-a",
      batchId: b0,
      file: "chapters/intro.tex",
      startLine: 2,
      endLine: 4,
      sectionId: "sec-1",
      claim: "c",
      evidence: "e",
    };
    expect(sectionIdCitedInWindow("sectionId=prefix-sec-1", "sec-1")).toBe(false);
    expect(
      findingTraceableInText(
        `findingId=${f.findingId} file=${f.file} linhas 2-4 sectionId=prefix-sec-1`,
        f
      )
    ).toBe(false);
    // Exact token still works
    expect(sectionIdCitedInWindow("sectionId=sec-1", "sec-1")).toBe(true);
    expect(sectionIdCitedInWindow("seção sec-1 ", "sec-1")).toBe(true);
  });

  test("same basename in different directory fails full-path provenance", () => {
    const f = {
      findingId: "fid-path-homonym-a",
      batchId: b0,
      file: "chapters/method.tex",
      startLine: 2,
      endLine: 4,
      sectionId: "sec-method",
      claim: "c",
      evidence: "e",
    };
    const g = {
      findingId: "fid-path-homonym-b",
      batchId: b2,
      file: "chapters/results.tex",
      startLine: 2,
      endLine: 5,
      sectionId: "sec-results",
      claim: "c",
      evidence: "e",
    };
    // Wrong directories with same basenames
    const text = [
      `findingId=${f.findingId} appendix/method.tex linhas 2-4 sectionId=sec-method`,
      `findingId=${g.findingId} appendix/results.tex linhas 2-5 sectionId=sec-results`,
    ].join("\n");
    expect(filePathCitedInWindow(text, "chapters/method.tex")).toBe(false);
    expect(filePathCitedInWindow("appendix/method.tex", "chapters/method.tex")).toBe(false);
    expect(filePathCitedInWindow("old-chapters/method.tex", "chapters/method.tex")).toBe(false);
    expect(findingTraceableInText(text, f)).toBe(false);
    expect(findingTraceableInText(text, g)).toBe(false);

    const reply = [
      "## Síntese global do manuscrito",
      "síntese",
      "## Contradições ou tensões entre seções",
      `Há tensão entre findingId=${f.findingId} appendix/method.tex linhas 2-4 sectionId=sec-method e findingId=${g.findingId} appendix/results.tex linhas 2-5 sectionId=sec-results.`,
      "## Coerência entre objetivos, método, resultados e conclusão",
      "x",
      "## Lacunas globais de argumentação ou evidência",
      "x",
      "## Redundâncias e inconsistências recorrentes",
      "x",
      "## Prioridades de revisão",
      "x",
    ].join("\n");
    expect(validateCrossBatchRelation(reply, [f, g]).ok).toBe(false);
    expect(validateCrossBatchRelation(reply, [f, g]).reason).toBe(
      "missing_file_line_section_traceability"
    );
  });

  test("basename-only citation fails when finding has directory path", () => {
    const f = {
      findingId: "fid-basename-only",
      batchId: b0,
      file: "chapters/method.tex",
      startLine: 2,
      endLine: 4,
      sectionId: "sec-method",
      claim: "c",
      evidence: "e",
    };
    const window = `findingId=${f.findingId} method.tex linhas 2-4 sectionId=sec-method`;
    expect(filePathCitedInWindow(window, "chapters/method.tex")).toBe(false);
    expect(filePathCitedInWindow(window, "method.tex")).toBe(true); // basename alone matches itself
    expect(findingTraceableInText(window, f)).toBe(false);
  });

  test("exact full path and exact sectionId still pass provenance", () => {
    // Full AnalysisFinding V1 shapes so isSinteseSuccessOutput accepts the envelope.
    const f = {
      ...findingPhase1,
      findingId: "fid-exact-path-a",
      file: "chapters/method.tex",
      sectionId: "sec-1",
    };
    const g = {
      ...findingPhase2,
      findingId: "fid-exact-path-b",
      file: "chapters/conclusion.tex",
      sectionId: "sec-2",
    };
    const allowShape = (x: typeof f) => ({
      findingId: x.findingId,
      batchId: x.batchId,
      file: x.file,
      startLine: x.startLine,
      endLine: x.endLine,
      sectionId: x.sectionId,
      claim: x.claim,
      evidence: x.evidence,
    });
    const windowA = `findingId=${f.findingId} chapters/method.tex linhas 2-4 sectionId=sec-1`;
    const windowB = `findingId=${g.findingId} chapters/conclusion.tex linhas 2-5 sectionId=sec-2`;
    expect(sectionIdCitedInWindow(windowA, "sec-1")).toBe(true);
    expect(filePathCitedInWindow(windowA, "chapters/method.tex")).toBe(true);
    expect(findingTraceableInText(windowA, allowShape(f))).toBe(true);
    expect(findingTraceableInText(windowB, allowShape(g))).toBe(true);

    const reply = [
      "## Síntese global do manuscrito",
      "O manuscrito apresenta tensão entre método e conclusão.",
      "",
      "## Contradições ou tensões entre seções",
      `Há tensão entre findingId=${f.findingId} em chapters/method.tex linhas 2-4 seção sec-1 e findingId=${g.findingId} em chapters/conclusion.tex linhas 2-5 seção sec-2. A relação entre esses findings de lotes distintos evidencia contradição.`,
      "",
      "## Coerência entre objetivos, método, resultados e conclusão",
      "coerência frágil",
      "",
      "## Lacunas globais de argumentação ou evidência",
      "nenhuma",
      "",
      "## Redundâncias e inconsistências recorrentes",
      "nenhuma",
      "",
      "## Prioridades de revisão",
      "revisar método vs conclusão",
    ].join("\n");
    expect(validateGlobalSectionOrder(reply).ok).toBe(true);
    const cross = validateCrossBatchRelation(reply, [allowShape(f), allowShape(g)]);
    expect(cross.ok).toBe(true);
    const gEval = evaluateGlobalSynthesis([
      oc("banca_sintese", {
        id: "s",
        output: fullSinteseJson({ findings: [f, g] }),
      }),
      ocText(reply),
    ]);
    expect(gEval.globalSynthesisOk).toBe(true);
    expect(gEval.globalSectionsOrdered).toBe(true);
    expect(gEval.globalCrossBatchRelation).toBe(true);
  });

  test("existing valid E2E fixture still returns MODEL_PROTOCOL_PASSED", () => {
    // Re-assert the composed happy path after provenance/title hardenings.
    expect(validateGlobalSectionOrder(validGlobalReplyText()).ok).toBe(true);
    expect(
      findingTraceableInText(validGlobalReplyText(), {
        findingId: findingPhase1.findingId,
        batchId: findingPhase1.batchId,
        file: findingPhase1.file,
        startLine: findingPhase1.startLine,
        endLine: findingPhase1.endLine,
        sectionId: findingPhase1.sectionId,
        claim: findingPhase1.claim,
        evidence: findingPhase1.evidence,
      })
    ).toBe(true);

    const phase1 = happyPhase1();
    const partial = happyPartial();
    const phase2 = happyPhase2();
    const evaluation = evalOpts({
      events: [...phase1, ...partial, ...phase2],
      phase1Events: phase1,
      partialSinteseEvents: partial,
      phase2Events: phase2,
      stateAfterPhase1: stateRunning(),
      stateAfterPhase2: stateComplete(),
      minBatches: 3,
      hashesMatch: true,
      resumeAcrossProcesses: true,
    });
    expect(evaluation.globalSynthesisOk).toBe(true);
    const classified = classifyProtocolPhase({
      hasAuthAndModel: true,
      initPassed: true,
      result: okResult("{}"),
      evaluation,
    });
    expect(classified.outcome).toBe("PASS");
    expect(classified.classification).toBe("MODEL_PROTOCOL_PASSED");
  });
});
