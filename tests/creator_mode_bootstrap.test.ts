import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = join(import.meta.dir, "..");
const guide = join(repo, "docs/development/creator-mode.md");
const origin = "https://github.com/Base-Analitica/DSHbanca.git";
const branch = "fixture-" + Math.random().toString(16).slice(2);

function run(command: string, args: string[], cwd?: string) {
  const p = spawnSync(command, args, {
    cwd, encoding: "utf8", timeout: 15000,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: tmpdir(),
      GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" }
  });
  if (p.error || p.status !== 0) throw new Error(command + " " + args.join(" ") + ": " + (p.stderr || p.error));
  return p.stdout.trim();
}
function quote(value: string) { return "'" + value.replaceAll("'", "'\\''") + "'"; }
function preflightSource() {
  const md = readFileSync(guide, "utf8");
  const fence = String.fromCharCode(96).repeat(3);
  const block = md.split(fence + "bash\n")[1]?.split("\n" + fence)[0] ?? "";
  const start = block.indexOf("# Preflight SOMENTE LEITURA");
  const boundary = block.indexOf("# FIM DO PREFLIGHT; início das instalações");
  const end = boundary >= 0 ? boundary : block.indexOf("npm install --prefix");
  if (start < 0 || end <= start) throw new Error("bootstrap preflight boundary absent");
  return block.slice(start, end);
}

describe("Creator Mode bootstrap guards (only synthetic files and Git repositories)", () => {
  let root: string, base: string, scratch: string, other: string;
  let baseSha: string, mergeBaseSha: string, headSha: string, source: string;
  const fresh = (name: string) => join(root, name);
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "dsh-creator-bootstrap-tests-"));
    base = fresh("base"); scratch = fresh("scratch"); other = fresh("wrong");
    run("git", ["init", "--quiet", "-b", "master", base]);
    writeFileSync(join(base, "README.md"), "synthetic\n");
    writeFileSync(join(base, ".gitignore"), ".env*\n");
    run("git", ["add", "."], base);
    run("git", ["-c", "user.name=Synthetic", "-c", "user.email=synthetic@example.invalid", "commit", "-qm", "fixture base"], base);
    mergeBaseSha = run("git", ["rev-parse", "HEAD"], base);
    run("git", ["remote", "add", "origin", origin], base);
    run("git", ["worktree", "add", "--quiet", "-b", branch, scratch, "master"], base);
    run("git", ["worktree", "add", "--quiet", "-b", "wrong-branch", other, "master"], base);
    writeFileSync(join(scratch, "feature.txt"), "synthetic PR commit\n");
    run("git", ["add", "feature.txt"], scratch);
    run("git", ["-c", "user.name=Synthetic", "-c", "user.email=synthetic@example.invalid", "commit", "-qm", "PR feature"], scratch);

    // Advance the verified base after creating the feature worktrees. This models
    // a PR whose current base tip differs from its historical merge-base.
    writeFileSync(join(base, "base-advance.txt"), "synthetic base advance\n");
    run("git", ["add", "base-advance.txt"], base);
    run("git", ["-c", "user.name=Synthetic", "-c", "user.email=synthetic@example.invalid", "commit", "-qm", "advance verified base"], base);
    baseSha = run("git", ["rev-parse", "HEAD"], base);
    run("git", ["update-ref", "refs/remotes/origin/master", baseSha], base);
    headSha = run("git", ["rev-parse", "HEAD"], scratch);
    source = preflightSource();
  });
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  function probe(params: { worktree?: string; home?: string; prefix?: string; expectedBranch?: string; expectedBaseBranch?: string; expectedHeadSha?: string; expectedBaseSha?: string; expectedMergeBaseSha?: string; sentinel?: boolean; repoSentinel?: boolean; swapAfterReservation?: boolean; mutateWorktreeAfterReservation?: boolean } = {}) {
    const script = [
      "set -euo pipefail",
      "export WORKTREE=" + quote(params.worktree ?? scratch),
      "export DSH_DEV_PREFIX=" + quote(params.prefix ?? fresh("prefix")),
      "export DSH_HOME=" + quote(params.home ?? fresh("home")),
      "export DSH_CREATOR_CLI=" + quote(fresh("fake-dsh.js")),
      "export EXPECTED_BRANCH=" + quote(params.expectedBranch ?? branch),
      "export EXPECTED_BASE_BRANCH=" + quote(params.expectedBaseBranch ?? "master"),
      "export EXPECTED_HEAD_SHA=" + quote(params.expectedHeadSha ?? (params.worktree === other ? run("git", ["rev-parse", "HEAD"], other) : headSha)),
      "export EXPECTED_BASE_SHA=" + quote(params.expectedBaseSha ?? baseSha),
      "export EXPECTED_MERGE_BASE_SHA=" + quote(params.expectedMergeBaseSha ?? mergeBaseSha),
      source,
      ...(params.swapAfterReservation ? [
        "printf 'synthetic\\n' > \"$DSH_DEV_PREFIX/original-sentinel\"",
        "mv -- \"$DSH_DEV_PREFIX\" \"$DSH_DEV_PREFIX-old\"",
        "mkdir -m 700 -- \"$DSH_DEV_PREFIX\"",
        "safe_exec \"$NODE_BIN\" -e 'process.exit(0)'"
      ] : []),
      ...(params.mutateWorktreeAfterReservation ? [
        "git -C \"$WORKTREE\" checkout --quiet --detach \"$EXPECTED_HEAD_SHA\"",
        "check_scratch"
      ] : []),
      "printf 'DOWNSTREAM_REACHED\\n'",
      ...(params.sentinel ? ["safe_exec node " + quote(fresh("fake-dsh.js"))] : []),
      ...(params.repoSentinel ? ["safe_repo_exec \"$BUN_BIN\" " + quote(fresh("fake-dsh.js"))] : [])
    ].join("\n");
    // Explicit synthetic environment; do not forward actual operator credentials into fixtures.
    return spawnSync("bash", ["-c", script], {
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: fresh("synthetic-parent-home"), CREDENTIAL_SENTINEL: "synthetic-credential-do-not-use" },
      encoding: "utf8", timeout: 15000
    });
  }
  function blocked(p: ReturnType<typeof probe>) {
    expect(p.status).not.toBe(0);
    expect(p.stderr).toContain("BLOCKED:");
    expect(p.stdout).not.toContain("DOWNSTREAM_REACHED");
  }

  test("valid linked worktree accepts independently verified base and merge-base values", () => {
    expect(baseSha).not.toBe(mergeBaseSha);
    expect(headSha).not.toBe(mergeBaseSha);
    expect(headSha).not.toBe(baseSha);
    const first = probe();
    expect(first.status).toBe(0);
    expect(first.stdout).toContain("DOWNSTREAM_REACHED");
    expect(existsSync(fresh("home"))).toBe(true);
    expect(existsSync(fresh("prefix"))).toBe(true);
    blocked(probe());
    rmSync(fresh("home"), { recursive: true, force: true });
    rmSync(fresh("prefix"), { recursive: true, force: true });
  });

  test("non-Git directory, symlink and main checkout fail", () => {
    mkdirSync(fresh("plain"));
    blocked(probe({ worktree: fresh("plain") }));
    symlinkSync(scratch, fresh("symlink"));
    blocked(probe({ worktree: fresh("symlink") }));
    blocked(probe({ worktree: base }));
  });

  test("wrong branch, current base and independently supplied merge-base fail closed", () => {
    blocked(probe({ worktree: other }));
    blocked(probe({ expectedBaseSha: "0".repeat(40) }));
    blocked(probe({ expectedMergeBaseSha: "0".repeat(40) }));
    blocked(probe({ expectedBranch: "other-branch" }));

    const markdown = readFileSync(guide, "utf8");
    expect(markdown).not.toMatch(/export EXPECTED_BRANCH=chore\/57-creator-dev-workflow/);
    expect(markdown).not.toMatch(/export EXPECTED_BASE_SHA=f3c22a901907f792633a6ed8979192e8dae34bd4/);
    expect(source).toContain('EXPECTED_MERGE_BASE_SHA');
    expect(source).toContain('rev-parse --verify "$BASE_REF^{commit}"');
    expect(source).toContain('merge-base "$BASE_REF" HEAD');
  });

  test("ignored .env.local blocks without revealing its synthetic contents", () => {
    const file = join(scratch, ".env.local");
    const sentinel = "SYNTHETIC_SENTINEL_NOT_A_REAL_SECRET";
    writeFileSync(file, sentinel);
    try {
      const p = probe();
      blocked(p);
      expect(p.stdout).not.toContain(sentinel);
      expect(p.stderr).not.toContain(sentinel);
      expect(source).toContain("find \"$WORKTREE\" -name '.env*' -print -quit");
      expect(readFileSync(file, "utf8")).toBe(sentinel);
      expect(existsSync(fresh("home"))).toBe(false);
      expect(existsSync(fresh("prefix"))).toBe(false);
    } finally { rmSync(file); }
  });

  test("clean child environment removes inherited synthetic credential", () => {
    writeFileSync(fresh("fake-dsh.js"), "console.log(JSON.stringify({secret:process.env.CREDENTIAL_SENTINEL??null,home:process.env.HOME,cwd:process.cwd()}))\n");
    const p = probe({ sentinel: true });
    expect(p.status).toBe(0);
    const data = JSON.parse(p.stdout.trim().split("\n").at(-1) ?? "{}");
    expect(data.secret).toBeNull();
    expect(data.home).toBe(join(fresh("home"), "operator-home"));
    expect(data.cwd).toBe(data.home);
    rmSync(fresh("home"), { recursive: true, force: true });
    rmSync(fresh("prefix"), { recursive: true, force: true });
  });

  test("Bun installation and all build/test validators use sanitized project runner", () => {
    const md = readFileSync(guide, "utf8");
    const fence = String.fromCharCode(96).repeat(3);
    const block = md.split(fence + "bash\n")[1]?.split("\n" + fence)[0] ?? "";
    const commands = [
      "install --frozen-lockfile", "run typecheck", "run build", "test tests/creator_mode_bootstrap.test.ts",
      "run validate:skills", "run validate:agents"
    ];
    const bunInvocations = block.split("\n").filter(line => line.includes("$BUN_BIN"));
    expect(bunInvocations).toEqual(commands.map(args => 'safe_repo_exec "$BUN_BIN" ' + args));
    expect(source).toContain("safe_repo_exec()");
  });

  test("real Bun child runs inside the project with a sanitized environment", () => {
    writeFileSync(fresh("fake-dsh.js"),
      "console.log(JSON.stringify({runtime:typeof Bun !== 'undefined' ? 'bun' : 'node',secret:process.env.CREDENTIAL_SENTINEL??null,home:process.env.HOME,cwd:process.cwd()}))\n");
    const p = probe({ repoSentinel: true });
    expect(p.status).toBe(0);
    const data = JSON.parse(p.stdout.trim().split("\n").at(-1) ?? "{}");
    expect(data.secret).toBeNull();
    expect(data.runtime).toBe("bun");
    expect(data.home).toBe(join(fresh("home"), "operator-home"));
    expect(data.cwd).toBe(scratch);
    rmSync(fresh("home"), { recursive: true, force: true });
    rmSync(fresh("prefix"), { recursive: true, force: true });
  });

  test("Git fixture subprocess environment is isolated", () => {
    const previous = process.env.GIT_FIXTURE_CHECK;
    process.env.GIT_FIXTURE_CHECK = "synthetic";
    try {
      expect(run("node", ["-e", "process.stdout.write(process.env.GIT_FIXTURE_CHECK ?? \"absent\")"])).toBe("absent");
    } finally {
      if (previous === undefined) delete process.env.GIT_FIXTURE_CHECK;
      else process.env.GIT_FIXTURE_CHECK = previous;
    }
  });

  test("existing home and prefix block without destroying sentinel", () => {
    const h = fresh("home"); mkdirSync(h); writeFileSync(join(h, "cordis.patch.yml"), "sentinel\n");
    blocked(probe()); expect(readFileSync(join(h, "cordis.patch.yml"), "utf8")).toBe("sentinel\n");
    rmSync(h, { recursive: true, force: true });
    const p = fresh("prefix"); mkdirSync(p); writeFileSync(join(p, "sentinel"), "untouched\n");
    blocked(probe()); expect(readFileSync(join(p, "sentinel"), "utf8")).toBe("untouched\n");
    rmSync(p, { recursive: true, force: true });
  });

  test("post-reservation path and worktree changes block before child execution", () => {
    blocked(probe({ swapAfterReservation: true }));
    expect(readFileSync(fresh("prefix-old/original-sentinel"), "utf8")).toBe("synthetic\n");
    rmSync(fresh("home"), { recursive: true, force: true });
    rmSync(fresh("prefix"), { recursive: true, force: true });
    rmSync(fresh("prefix-old"), { recursive: true, force: true });

    blocked(probe({ mutateWorktreeAfterReservation: true }));
    rmSync(fresh("home"), { recursive: true, force: true });
    rmSync(fresh("prefix"), { recursive: true, force: true });
  });

  test("a submodule gitfile does not count as a linked worktree", () => {
    const sub = fresh("submodule-source");
    run("git", ["init", "--quiet", "-b", branch, sub]);
    writeFileSync(join(sub, "a.txt"), "submodule\n");
    run("git", ["add", "."], sub);
    run("git", ["-c", "user.name=Synthetic", "-c", "user.email=synthetic@example.invalid", "commit", "-qm", "sub"], sub);
    const superproj = fresh("super");
    run("git", ["init", "--quiet", "-b", "master", superproj]);
    writeFileSync(join(superproj, "a.txt"), "super\n");
    run("git", ["add", "."], superproj);
    run("git", ["-c", "user.name=Synthetic", "-c", "user.email=synthetic@example.invalid", "commit", "-qm", "super"], superproj);
    run("git", ["-c", "protocol.file.allow=always", "submodule", "add", "--quiet", sub, "child"], superproj);
    const child = join(superproj, "child");
    expect(readFileSync(join(child, ".git"), "utf8").startsWith("gitdir:")).toBe(true);
    run("git", ["checkout", "-q", branch], child);
    run("git", ["remote", "set-url", "origin", origin], child);
    const childSha = run("git", ["rev-parse", "HEAD"], child);
    run("git", ["update-ref", "refs/remotes/origin/master", childSha], child);
    blocked(probe({ worktree: child, expectedHeadSha: childSha, expectedBaseSha: childSha, expectedMergeBaseSha: childSha }));
  });
});
