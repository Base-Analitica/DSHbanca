import { test, expect } from "bun:test"
import { spawnSync } from "node:child_process"

// Removing native registrations, losing nested schemas, or using the host cwd
// instead of the agent session must break this packaged-entry regression.
test("DSH bundle exposes all 16 tools and executes banca_context in the agent workspace", () => {
  const build = spawnSync("bun", ["run", "build"], { encoding: "utf8" })
  expect(build.status, build.stderr).toBe(0)
  const run = spawnSync("node", ["--input-type=module", "-e", `
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { createRequire } from 'node:module';
let runtime;
if (process.env.DSH_TEST_HOST_PACKAGE) {
  const require = createRequire(process.env.DSH_TEST_HOST_PACKAGE);
  const { Context } = await import(require.resolve('@deepseek-ai/cordis'));
  const { default: SystemPrompt } = await import(require.resolve('@deepseek-ai/dsh-system-prompt'));
  const { default: ToolRuntime } = await import(require.resolve('@deepseek-ai/dsh-tools'));
  const ctx = new Context();
  new SystemPrompt(ctx, {});
  runtime = new ToolRuntime(ctx);
}
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const patch = parse(readFileSync(pkg.dsh.bundle.patch, 'utf8'));
const plugin = await import(patch[0].insert[0].name);
const tools = new Map();
let provider;
await plugin.apply({
  skills: { registerProvider: factory => { provider = factory(); } },
  tools: { register: definition => { tools.set(definition.name, definition); runtime?.register(definition); } },
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
  await assert.rejects(() => context.execute({}, { signal: exec.signal }));
  const result = await context.execute({projectRoot:'.'}, exec);
  if (runtime) {
    assert.equal(runtime.schemas().length, 16);
    const dispatched = await runtime.execute({ ...exec, callId:'regression', name:'banca_context', arguments:{} });
    assert.equal(dispatched.isError, false, JSON.stringify(dispatched));
    assert.match(dispatched.value, /^context → /);
    const invalid = await runtime.execute({ ...exec, callId:'invalid', name:'banca_context', arguments:{completedBatchId:42} });
    assert.equal(invalid.isError, true);
  }
  assert.match(result, /^context → /);
  assert(readFileSync(result.replace(/^context → /, ''), 'utf8').includes('Conteudo academico de teste.'));
  assert.deepEqual(context.output.render({}, result), [{type:'text', text:result}]);
  await assert.rejects(() => context.execute({ completedBatchId: 42 }, exec));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => context.execute({}, {...exec, signal:controller.signal}));
  console.log('PASS: 16 tools, schemas, skills, session cwd, execution, validation, cancellation');
} finally { rmSync(root, { recursive: true, force: true }); }
`], { encoding: "utf8" })
  expect(run.status, run.stderr).toBe(0)
  expect(run.stdout).toContain("PASS: 16 tools")
}, 60_000)
