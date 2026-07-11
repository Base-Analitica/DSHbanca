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
  hasStructuredProtocolFailure,
  type ProcessLike,
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

const perfectProtocolEval = {
  skillArgsCorrect: true,
  skillEvidence: true,
  skillSucceeded: true,
  contextCalled: true,
  auditarCalled: true,
  correctOrder: true,
  hashesMatch: true,
  claimedSubagentWithoutEvidence: false,
};

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
  } = {}
) {
  return {
    type: "tool_use",
    timestamp: Date.now(),
    sessionID: "ses_test",
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
      evaluation: {
        skillArgsCorrect: r.skillArgsCorrect,
        skillEvidence: r.skillEvidence,
        skillSucceeded: r.skillSucceeded,
        contextCalled: r.contextCalled,
        auditarCalled: r.auditarCalled,
        correctOrder: r.correctOrder,
        hashesMatch: true,
        claimedSubagentWithoutEvidence: false,
      },
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
      evaluation: {
        skillArgsCorrect: true,
        skillEvidence: true,
        skillSucceeded: true,
        contextCalled: r.contextCalled,
        auditarCalled: true,
        correctOrder: true,
        hashesMatch: true,
        claimedSubagentWithoutEvidence: false,
      },
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
      evaluation: {
        skillArgsCorrect: true,
        skillEvidence: true,
        skillSucceeded: true,
        contextCalled: true,
        auditarCalled: true,
        correctOrder: true,
        hashesMatch: true,
        claimedSubagentWithoutEvidence: false,
      },
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
        skillArgsCorrect: true,
        skillEvidence: true,
        skillSucceeded: true,
        contextCalled: true,
        auditarCalled: true,
        correctOrder: true,
        hashesMatch: true,
        claimedSubagentWithoutEvidence: false,
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
        const d = join(project, ".opencode", "skills", s);
        mkdirSync(d, { recursive: true });
        writeFileSync(join(d, "SKILL.md"), `---\nname: ${s}\ndescription: x\n---\n`);
      }
      const globalLoc = "/tmp/global-config/skills/banca-avaliacao/SKILL.md";
      const payload = JSON.stringify([
        { name: "banca-avaliacao", location: globalLoc },
        { name: "banca-correcao", location: join(project, ".opencode/skills/banca-correcao/SKILL.md") },
        { name: "banca-detector-ia", location: join(project, ".opencode/skills/banca-detector-ia/SKILL.md") },
        { name: "banca-grille", location: join(project, ".opencode/skills/banca-grille/SKILL.md") },
        { name: "banca-plagio", location: join(project, ".opencode/skills/banca-plagio/SKILL.md") },
        { name: "banca-planejador", location: join(project, ".opencode/skills/banca-planejador/SKILL.md") },
        { name: "banca-referencias", location: join(project, ".opencode/skills/banca-referencias/SKILL.md") },
        { name: "banca-revisor", location: join(project, ".opencode/skills/banca-revisor/SKILL.md") },
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
        const d = join(project, ".opencode", "skills", s);
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

  test("agents listed but missing from project .opencode fail", () => {
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

  // Dynamic OpenCode proofs must not silently pass when the binary is absent.
  const openCodeBinForDynamicProof = resolveBinary();

  test.skipIf(!openCodeBinForDynamicProof)(
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
        mkdirSync(join(project, ".opencode", "commands"), { recursive: true });
        mkdirSync(join(project, ".opencode", "plugins"), { recursive: true });
        writeFileSync(
          join(project, ".opencode", "commands", "banca-init.md"),
          readFileSync(join(repo, "assets/opencode/commands/banca-init.md"))
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
          join(project, ".opencode", "plugins", "openbanca-e2e.ts"),
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
          model: process.env.OPENCODE_E2E_MODEL || "opencode/mimo-v2.5-free",
          command: "banca-init",
        });
        const res = runSafe(bin, args, project, 90000, env);

        // Global contaminant must never run.
        expect(existsSync(marker)).toBe(false);

        // Full behavioral proof is required when OpenCode is available in the environment.
        // Soft-passing on non-zero status is not allowed: that overstated isolation confidence.
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
    { timeout: 180000 }
  );
  // If OpenCode is absent, the contamination proof above is skipped (not counted as PASS).
});
