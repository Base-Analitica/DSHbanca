import { test, expect } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, realpathSync } from "node:fs"
import { dirname, join } from "node:path"

// Resolve a real DSH host installation so the native ToolRuntime proofs can
// run. The env var remains the explicit override; otherwise a globally
// installed `dsh` binary is used. Without a host the native section reports
// NATIVE_NONE (skipped, never simulated).
function resolveDshHostPackage(): string | undefined {
  if (process.env.DSH_TEST_HOST_PACKAGE) return process.env.DSH_TEST_HOST_PACKAGE
  const which = spawnSync("which", ["dsh"], { encoding: "utf8" })
  if (which.status !== 0) return undefined
  const bin = (which.stdout ?? "").trim().split("\n")[0]
  if (!bin) return undefined
  try {
    const real = realpathSync(bin)
    const pkg = join(dirname(real), "..", "package.json")
    return existsSync(pkg) ? pkg : undefined
  } catch {
    return undefined
  }
}

// Removing native registrations, losing nested schemas, or using the host cwd
// instead of the agent session must break this packaged-entry regression.
// The native section additionally proves, through the real ToolRuntime, that
// the guard denies auditor mutations before any tool body runs, that a
// verified corrector still works, that unverifiable delegation never grants
// manuscript mutation, and that scope-registered guards are removed when the
// Cordis scope is disposed.
test("DSH bundle exposes all 16 tools, executes banca_context in the agent workspace, and the native ToolRuntime guard enforces read-only auditor policy", () => {
  const build = spawnSync("bun", ["run", "build"], { encoding: "utf8" })
  expect(build.status, build.stderr).toBe(0)
  const dshHost = resolveDshHostPackage()
  const run = spawnSync("node", ["--input-type=module", "-e", `
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { createRequire } from 'node:module';

let hostCtx, runtime, hostRequire, hostVersion;
if (process.env.DSH_TEST_HOST_PACKAGE) {
  hostRequire = createRequire(process.env.DSH_TEST_HOST_PACKAGE);
  hostVersion = JSON.parse(readFileSync(process.env.DSH_TEST_HOST_PACKAGE, 'utf8')).version;
  const { Context } = await import(hostRequire.resolve('@deepseek-ai/cordis'));
  const { default: SystemPrompt } = await import(hostRequire.resolve('@deepseek-ai/dsh-system-prompt'));
  const { default: ToolRuntime } = await import(hostRequire.resolve('@deepseek-ai/dsh-tools'));
  hostCtx = new Context();
  new SystemPrompt(hostCtx, {});
  runtime = new ToolRuntime(hostCtx);
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const patch = parse(readFileSync(pkg.dsh.bundle.patch, 'utf8'));
const plugin = await import(patch[0].insert[0].name);
const tools = new Map();
const guards = [];
let provider;
await plugin.apply({
  skills: { registerProvider: factory => { provider = factory(); } },
  tools: {
    register: definition => { tools.set(definition.name, definition); },
    guard: guardFn => guards.push(guardFn),
  },
  get: () => undefined,
});
const names = ['init','status','context','auditar','sintese','corrigir','refs','ia','plagio','loop','snapshot','compile','checklist','restore','validate','contract'].map(n => 'banca_' + n);
assert.deepEqual([...tools.keys()].sort(), names.sort());
assert(plugin.inject.includes('tools'));
assert((await provider.list({})).some(s => s.name === 'banca-avaliacao'));
for (const tool of tools.values()) {
  assert.equal(tool.parameters.type, 'object');
  assert.equal(tool.output.schema.type, 'string');
}
assert.equal(tools.get('banca_corrigir').parameters.properties.corrections.items.properties.file.type, 'string');
assert(tools.get('banca_plagio').parameters.required.includes('reportPath'));
const root = mkdtempSync(join(tmpdir(), 'dshbanca-native-'));
try {
  writeFileSync(join(root, 'main.tex'), 'Conteudo academico de teste.');
  const context = tools.get('banca_context');
  const exec = { agent: { session: { header: { cwd: root } } }, signal: new AbortController().signal };
  const init = await tools.get('banca_init').execute({}, exec);
  assert.match(init, /assets installed/);
  assert.equal(
    readFileSync(join(root, '.banca', 'style-guide.md'), 'utf8'),
    readFileSync('assets/templates/style-guide.md', 'utf8'),
  );
  // no session cwd: the wrapper must fail closed instead of using the host cwd
  await assert.rejects(() => context.execute({}, { signal: exec.signal }));
  const result = await context.execute({projectRoot:'.'}, exec);
  assert.match(result, /^context → /);
  assert(readFileSync(result.replace(/^context → /, ''), 'utf8').includes('Conteudo academico de teste.'));
  assert.deepEqual(context.output.render({}, result), [{type:'text', text:result}]);
  await assert.rejects(() => context.execute({ completedBatchId: 42 }, exec));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => context.execute({}, {...exec, signal:controller.signal}));
  console.log('PASS: 16 tools, schemas, skills, session cwd, execution, validation, cancellation');
} finally { rmSync(root, { recursive: true, force: true }); }

if (!runtime) {
  console.log('NATIVE_NONE: no real DSH host package available; ToolRuntime guard proofs skipped');
} else {
  const { createScope } = await import(hostRequire.resolve('@deepseek-ai/dsh-scope'));
  // Native registration through the real tools service. The guard registered
  // by apply() lands in the global layer and is consulted for every dispatch.
  await plugin.apply(hostCtx);
  assert.equal(runtime.schemas().length, 16);
  const signal = () => new AbortController().signal;
  const guardRoot = mkdtempSync(join(tmpdir(), 'dshbanca-guard-'));
  try {
    writeFileSync(join(guardRoot, 'main.tex'), 'alpha beta');
    const agentOf = header => ({ session: { header: { cwd: guardRoot, ...header } } });
    const auditor = agentOf({ agentPreset: 'banca-auditor' });
    const corrector = agentOf({ agentPreset: 'banca-corretor' });

    // 1. auditor is denied by the real pipeline, before the body runs, with zero side effects
    const rInit = await runtime.execute({ callId:'g1', name:'banca_init', arguments:{}, agent: auditor, signal: signal() });
    assert.equal(rInit.isError, true, JSON.stringify(rInit));
    assert.match(rInit.content[0].text, /read-only/);
    assert.equal(existsSync(join(guardRoot, '.banca')), false);
    const rCorr = await runtime.execute({ callId:'g2', name:'banca_corrigir', arguments:{ corrections:[{file:'main.tex', oldText:'alpha', newText:'omega'}] }, agent: auditor, signal: signal() });
    assert.equal(rCorr.isError, true, JSON.stringify(rCorr));
    assert.match(rCorr.content[0].text, /read-only/);
    const rRest = await runtime.execute({ callId:'g3', name:'banca_restore', arguments:{ snapshotId:'x', confirm:true }, agent: auditor, signal: signal() });
    assert.equal(rRest.isError, true, JSON.stringify(rRest));
    assert.equal(readFileSync(join(guardRoot, 'main.tex'), 'utf8'), 'alpha beta');

    // 2. a delegated auditor child keeps the inherited read-only lineage
    const rChild = await runtime.execute({ callId:'g4', name:'banca_corrigir', arguments:{ corrections:[{file:'main.tex', oldText:'alpha', newText:'omega'}] }, agent: agentOf({ agentPreset:'banca-auditor', origin:'subagent' }), signal: signal() });
    assert.equal(rChild.isError, true, JSON.stringify(rChild));
    assert.equal(readFileSync(join(guardRoot, 'main.tex'), 'utf8'), 'alpha beta');

    // 3. auditor keeps legitimate academic persistence: context pack + checkpoint
    const rCtx = await runtime.execute({ callId:'g5', name:'banca_context', arguments:{}, agent: auditor, signal: signal() });
    assert.equal(rCtx.isError, false, JSON.stringify(rCtx));
    assert.match(String(rCtx.value), /^context → /);
    assert.equal(existsSync(join(guardRoot, '.banca', 'analysis')), true);
    assert.equal(existsSync(join(guardRoot, '.banca', 'context')), true);

    // 4. verified corrector mutates the manuscript through the same pipeline
    const rFix = await runtime.execute({ callId:'g6', name:'banca_corrigir', arguments:{ corrections:[{file:'main.tex', oldText:'alpha', newText:'omega'}] }, agent: corrector, signal: signal() });
    assert.equal(rFix.isError, false, JSON.stringify(rFix));
    assert.equal(readFileSync(join(guardRoot, 'main.tex'), 'utf8'), 'omega beta');

    // 5. delegated agent without verifiable identity may not mutate the manuscript
    writeFileSync(join(guardRoot, 'main.tex'), 'alpha beta');
    const rAnon = await runtime.execute({ callId:'g7', name:'banca_corrigir', arguments:{ corrections:[{file:'main.tex', oldText:'alpha', newText:'omega'}] }, agent: agentOf({ origin:'subagent' }), signal: signal() });
    assert.equal(rAnon.isError, true, JSON.stringify(rAnon));
    assert.match(rAnon.content[0].text, /corretor/);
    assert.equal(readFileSync(join(guardRoot, 'main.tex'), 'utf8'), 'alpha beta');

    // 6. missing session identity fails closed (no agent, no cwd)
    const rNoAgent = await runtime.execute({ callId:'g8', name:'banca_init', arguments:{}, signal: signal() });
    assert.equal(rNoAgent.isError, true, JSON.stringify(rNoAgent));
    const rNoCwd = await runtime.execute({ callId:'g9', name:'banca_init', arguments:{}, agent: { session: { header: {} } }, signal: signal() });
    assert.equal(rNoCwd.isError, true, JSON.stringify(rNoCwd));

    // 7. behavioral proof that the guard intercepts before any tool body:
    // agent-scoped decoy definitions whose bodies contain no identity checks.
    const markerDenied = join(guardRoot, 'DECOY_AUDITOR_RAN');
    const markerControl = join(guardRoot, 'DECOY_CORRECTOR_RAN');
    let deniedRuns = 0;
    let controlRuns = 0;
    let visibilityRuns = 0;
    const decoyOutput = { schema: { type: 'string' }, render: (a, v) => [{ type: 'text', text: v }] };
    const auditorScope = createScope(hostCtx, auditor);
    auditorScope.ctx.tools.register({ name:'banca_corrigir', description:'decoy', parameters:{ type:'object' }, output: decoyOutput, async execute(){ deniedRuns++; writeFileSync(markerDenied,'ran'); return 'decoy'; } });
    auditorScope.ctx.tools.register({ name:'decoy_visibility_probe', description:'probe', parameters:{ type:'object' }, output: decoyOutput, async execute(){ visibilityRuns++; return 'probe-ran'; } });
    const probe = await runtime.execute({ callId:'g10', name:'decoy_visibility_probe', arguments:{}, agent: auditor, signal: signal() });
    assert.equal(probe.isError, false, JSON.stringify(probe));
    assert.equal(visibilityRuns, 1);
    const deniedDecoy = await runtime.execute({ callId:'g11', name:'banca_corrigir', arguments:{}, agent: auditor, signal: signal() });
    assert.equal(deniedDecoy.isError, true, JSON.stringify(deniedDecoy));
    assert.match(deniedDecoy.content[0].text, /read-only/);
    assert.equal(deniedRuns, 0);
    assert.equal(existsSync(markerDenied), false);
    const correctorScope = createScope(hostCtx, corrector);
    correctorScope.ctx.tools.register({ name:'banca_corrigir', description:'decoy-control', parameters:{ type:'object' }, output: decoyOutput, async execute(){ controlRuns++; writeFileSync(markerControl,'ran'); return 'decoy-ok'; } });
    const control = await runtime.execute({ callId:'g12', name:'banca_corrigir', arguments:{}, agent: corrector, signal: signal() });
    assert.equal(control.isError, false, JSON.stringify(control));
    assert.equal(controlRuns, 1);
    assert.equal(existsSync(markerControl), true);

    // 8. guard lifecycle: a scope-registered guard applies only to its agent
    // and is removed when the Cordis scope is disposed.
    const victim = agentOf({ agentPreset: 'banca-corretor' });
    const other = agentOf({ agentPreset: 'banca-corretor' });
    const guardScope = createScope(hostCtx, victim);
    guardScope.ctx.tools.guard(() => 'scoped-denial-probe');
    const victimDenied = await runtime.execute({ callId:'g13', name:'banca_status', arguments:{}, agent: victim, signal: signal() });
    assert.equal(victimDenied.isError, true, JSON.stringify(victimDenied));
    assert.match(victimDenied.content[0].text, /scoped-denial-probe/);
    const otherAllowed = await runtime.execute({ callId:'g14', name:'banca_status', arguments:{}, agent: other, signal: signal() });
    assert.equal(otherAllowed.isError, false, JSON.stringify(otherAllowed));
    await guardScope.dispose();
    const victimAfter = await runtime.execute({ callId:'g15', name:'banca_status', arguments:{}, agent: victim, signal: signal() });
    assert.equal(victimAfter.isError, false, JSON.stringify(victimAfter));
    await auditorScope.dispose();
    await correctorScope.dispose();
    console.log('NATIVE_GUARD_PASS dsh@' + hostVersion + ': real ToolRuntime registered 16 tools; denied auditor and unverified-subagent mutations before body execution; allowed verified corrector; scope guard lifecycle verified');
  } finally { rmSync(guardRoot, { recursive: true, force: true }); }
}
`], {
    encoding: "utf8",
    env: dshHost ? { ...process.env, DSH_TEST_HOST_PACKAGE: dshHost } : { ...process.env },
  })
  expect(run.status, run.stderr).toBe(0)
  expect(run.stdout).toContain("PASS: 16 tools")
  expect(run.stdout).toMatch(/NATIVE_GUARD_PASS|NATIVE_NONE/)
}, 60_000)
