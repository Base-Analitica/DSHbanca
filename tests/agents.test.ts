import { expect, test, describe } from "bun:test";
import { writeFileSync, rmSync, mkdirSync, existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";
import { installAssets } from "../src/lib/install_assets";

const VALID_AGENT_LF = `---
description: Avalia a monografia nos eixos ABNT, citações, conteúdo e estilo.
mode: subagent
permission:
  "*": deny
  skill:
    "*": deny
    banca-avaliacao: allow
  banca_context: allow
  banca_auditar: allow
  banca_status: allow
---
## Auditor
`;

const VALID_AGENT_CRLF = VALID_AGENT_LF.replace(/\n/g, "\r\n");

function createValidAgents(dir: string, content = VALID_AGENT_LF) {
  mkdirSync(dir, { recursive: true });
  const names = [
    "banca-auditor.md",
    "banca-corretor.md",
    "banca-fontes.md",
    "banca-integrador.md",
    "banca-loop.md"
  ];
  for (const name of names) {
    writeFileSync(join(dir, name), content);
  }
}

function runValidator(dir: string): { status: number | null, stdout: string, stderr: string } {
  const result = spawnSync("bun", ["run", "scripts/validate-agents.ts"], {
    env: { ...process.env, AGENTS_DIR: dir },
    encoding: "utf8"
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr
  };
}

describe("Agent Validation", () => {
  test("valid LF agents", () => {
    const dir = join(tmpdir(), "agents-lf-" + Date.now());
    try {
      createValidAgents(dir, VALID_AGENT_LF);
      const res = runValidator(dir);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("Successfully validated");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("valid CRLF agents", () => {
    const dir = join(tmpdir(), "agents-crlf-" + Date.now());
    try {
      createValidAgents(dir, VALID_AGENT_CRLF);
      const res = runValidator(dir);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("Successfully validated");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("Markdown body containing a standalone ---", () => {
    const dir = join(tmpdir(), "agents-dash-" + Date.now());
    try {
      createValidAgents(dir);
      writeFileSync(join(dir, "banca-auditor.md"), VALID_AGENT_LF + "\n---\nMore content");
      const res = runValidator(dir);
      expect(res.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("empty directory", () => {
    const dir = join(tmpdir(), "agents-empty-" + Date.now());
    try {
      mkdirSync(dir, { recursive: true });
      const res = runValidator(dir);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain("Empty directory");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("missing expected agent", () => {
    const dir = join(tmpdir(), "agents-missing-" + Date.now());
    try {
      createValidAgents(dir);
      rmSync(join(dir, "banca-auditor.md"));
      const res = runValidator(dir);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain("Missing expected agent: banca-auditor.md");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("unexpected agent", () => {
    const dir = join(tmpdir(), "agents-unexp-" + Date.now());
    try {
      createValidAgents(dir);
      writeFileSync(join(dir, "banca-extra.md"), VALID_AGENT_LF);
      const res = runValidator(dir);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain("Unexpected agent file: banca-extra.md");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("missing description", () => {
    const dir = join(tmpdir(), "agents-nodesc-" + Date.now());
    try {
      createValidAgents(dir);
      writeFileSync(join(dir, "banca-auditor.md"), "---\nmode: subagent\n---\n");
      const res = runValidator(dir);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain("Invalid or missing 'description'");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("empty description", () => {
    const dir = join(tmpdir(), "agents-emptydesc-" + Date.now());
    try {
      createValidAgents(dir);
      writeFileSync(join(dir, "banca-auditor.md"), "---\ndescription: ' '\n---\n");
      const res = runValidator(dir);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain("Invalid or missing 'description'");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("invalid mode", () => {
    const dir = join(tmpdir(), "agents-badmode-" + Date.now());
    try {
      createValidAgents(dir);
      writeFileSync(join(dir, "banca-auditor.md"), "---\ndescription: desc\nmode: God\n---\n");
      const res = runValidator(dir);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain("Invalid 'mode'");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("empty/null YAML frontmatter", () => {
    const dir = join(tmpdir(), "agents-emptyyaml-" + Date.now());
    try {
      createValidAgents(dir);
      writeFileSync(join(dir, "banca-auditor.md"), "---\n# Just comments\n---\n");
      const res = runValidator(dir);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain("Frontmatter must be a plain object");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("tools as array", () => {
    const dir = join(tmpdir(), "agents-toolsarr-" + Date.now());
    try {
      createValidAgents(dir);
      writeFileSync(join(dir, "banca-auditor.md"), "---\ndescription: desc\ntools: ['a']\n---\n");
      const res = runValidator(dir);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain("'tools' must be a plain object");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("tools as null", () => {
    const dir = join(tmpdir(), "agents-toolsnull-" + Date.now());
    try {
      createValidAgents(dir);
      writeFileSync(join(dir, "banca-auditor.md"), "---\ndescription: desc\ntools: null\n---\n");
      const res = runValidator(dir);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain("'tools' must be a plain object");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("tools as scalar", () => {
    const dir = join(tmpdir(), "agents-toolsscal-" + Date.now());
    try {
      createValidAgents(dir);
      writeFileSync(join(dir, "banca-auditor.md"), "---\ndescription: desc\ntools: true\n---\n");
      const res = runValidator(dir);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain("'tools' must be a plain object");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("tools value not boolean", () => {
    const dir = join(tmpdir(), "agents-toolsbadval-" + Date.now());
    try {
      createValidAgents(dir);
      writeFileSync(join(dir, "banca-auditor.md"), "---\ndescription: desc\ntools:\n  a: allow\n---\n");
      const res = runValidator(dir);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain("'tools' values must be booleans");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("permission as array", () => {
    const dir = join(tmpdir(), "agents-permarr-" + Date.now());
    try {
      createValidAgents(dir);
      writeFileSync(join(dir, "banca-auditor.md"), "---\ndescription: desc\npermission: ['a']\n---\n");
      const res = runValidator(dir);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain("'permission' must be a plain object");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("permission as scalar", () => {
    const dir = join(tmpdir(), "agents-permscal-" + Date.now());
    try {
      createValidAgents(dir);
      writeFileSync(join(dir, "banca-auditor.md"), "---\ndescription: desc\npermission: true\n---\n");
      const res = runValidator(dir);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain("'permission' must be a plain object");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("invalid nested permission array", () => {
    const dir = join(tmpdir(), "agents-permnestarr-" + Date.now());
    try {
      createValidAgents(dir);
      writeFileSync(join(dir, "banca-auditor.md"), "---\ndescription: desc\npermission:\n  skill:\n    - a\n---\n");
      const res = runValidator(dir);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain("Arrays are not allowed in permission map");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("invalid permission action", () => {
    const dir = join(tmpdir(), "agents-permact-" + Date.now());
    try {
      createValidAgents(dir);
      writeFileSync(join(dir, "banca-auditor.md"), "---\ndescription: desc\npermission:\n  a: execute\n---\n");
      const res = runValidator(dir);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain("Invalid permission action 'execute'");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("invalid YAML", () => {
    const dir = join(tmpdir(), "agents-badyaml-" + Date.now());
    try {
      createValidAgents(dir);
      writeFileSync(join(dir, "banca-auditor.md"), "---\nbad yaml:\n [\n---\n");
      const res = runValidator(dir);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain("Invalid YAML");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("missing frontmatter opening delimiter", () => {
    const dir = join(tmpdir(), "agents-noopen-" + Date.now());
    try {
      createValidAgents(dir);
      writeFileSync(join(dir, "banca-auditor.md"), "description: desc\n---\n");
      const res = runValidator(dir);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain("Missing frontmatter opening delimiter");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("missing frontmatter closing delimiter", () => {
    const dir = join(tmpdir(), "agents-noclose-" + Date.now());
    try {
      createValidAgents(dir);
      writeFileSync(join(dir, "banca-auditor.md"), "---\ndescription: desc\n");
      const res = runValidator(dir);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain("Missing frontmatter closing delimiter");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

  test("fallback installation exact normalization equality", () => {
    const tmpProject = join(tmpdir(), "opencode-banca-" + Date.now());
    const nonexistentDir = join(tmpProject, "this-does-not-exist");

    try {
      installAssets(tmpProject, true, nonexistentDir);

      const installedAgentsDir = join(tmpProject, ".opencode", "agents");
      expect(existsSync(installedAgentsDir)).toBe(true);

      const expectedAgents = [
        "banca-auditor.md",
        "banca-corretor.md",
        "banca-fontes.md",
        "banca-integrador.md",
        "banca-loop.md"
      ];

      const versionedDir = join(process.cwd(), "assets", "opencode", "agents");

      for (const agent of expectedAgents) {
        const fallbackPath = join(installedAgentsDir, agent);
        const versionedPath = join(versionedDir, agent);

        expect(existsSync(fallbackPath)).toBe(true, `Fallback agent missing: ${agent}`);

        const fallbackContent = readFileSync(fallbackPath, "utf8").replace(/\r\n/g, "\n").trim();
        const versionedContent = readFileSync(versionedPath, "utf8").replace(/\r\n/g, "\n").trim();

        expect(fallbackContent).toBe(versionedContent);
      }

      // Check no extra files
      const files = readdirSync(installedAgentsDir);
      expect(files.length).toBe(expectedAgents.length);

      // Validate the output directory with the validator script
      const res = runValidator(installedAgentsDir);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("Successfully validated agents");

    } finally {
      rmSync(tmpProject, { recursive: true, force: true });
    }
  });

  test("normal installation directory passes validation", () => {
    const tmpProject = join(tmpdir(), "opencode-banca-normal-" + Date.now());

    try {
      installAssets(tmpProject, true); // normal copy from assets

      const installedAgentsDir = join(tmpProject, ".opencode", "agents");
      expect(existsSync(installedAgentsDir)).toBe(true);

      const res = runValidator(installedAgentsDir);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("Successfully validated agents");

    } finally {
      rmSync(tmpProject, { recursive: true, force: true });
    }
  });

  test("invalid deeply nested permission map", () => {
    const dir = join(tmpdir(), "agents-permdeep-" + Date.now());
    try {
      createValidAgents(dir);
      writeFileSync(join(dir, "banca-auditor.md"), "---\ndescription: desc\nmode: subagent\npermission:\n  skill:\n    banca-avaliacao:\n      deep: allow\n---\n");
      const res = runValidator(dir);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain("Deeply nested permission maps are not allowed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
