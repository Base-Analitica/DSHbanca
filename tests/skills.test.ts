import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { join } from "path";
import { spawnSync } from "child_process";
import { tmpdir } from "os";
import { readFileSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync, mkdtempSync } from "fs";
import { validateSkill, validateAllSkills } from "../scripts/validate-skills";
import { installAssets } from "../src/lib/install_assets";

const EXPECTED_SKILLS = [
  "banca-avaliacao",
  "banca-correcao",
  "banca-detector-ia",
  "banca-grille",
  "banca-plagio",
  "banca-planejador",
  "banca-referencias",
  "banca-revisor"
];

describe("Skills Validation", () => {
  const canonicalSkillsDir = join(__dirname, "..", "skills");
  const versionedSkillsDir = join(__dirname, "..", "assets", "dsh", "skills");

  test("1 & 2. all canonical skills in skills/ are valid and names match directories", () => {
    const errors = validateAllSkills(canonicalSkillsDir);
    expect(errors).toHaveLength(0);
  });

  test("3. all names in skills/ are unique", () => {
    const errors = validateAllSkills(canonicalSkillsDir);
    const duplicates = errors.filter(e => e.message.includes("Duplicate skill name"));
    expect(duplicates).toHaveLength(0);
  });

  test("4. all skills in skills/ have valid description", () => {
     const errors = validateAllSkills(canonicalSkillsDir);
     const descErrors = errors.filter(e => e.message.includes("description"));
     expect(descErrors).toHaveLength(0);
  });

  test("canonical skills/ contains exactly the 8 expected skills", () => {
    const dirs = readdirSync(canonicalSkillsDir, { withFileTypes: true })
      .filter((d: any) => d.isDirectory())
      .map((d: any) => d.name);
    expect(dirs.length).toBe(8);
    expect([...dirs].sort()).toEqual([...EXPECTED_SKILLS].sort());
  });

  test("all mirror skills in assets/dsh/skills are valid", () => {
    const errors = validateAllSkills(versionedSkillsDir);
    expect(errors).toHaveLength(0);
  });

  describe("Invalid fixtures rejection", () => {
    const fixturesDir = mkdtempSync(join(tmpdir(), 'skills-fixtures-'));

    afterAll(() => {
        rmSync(fixturesDir, { recursive: true, force: true });
    });

    test("LF frontmatter is accepted", () => {
        const p = join(fixturesDir, "lf-valid.md");
        writeFileSync(p, "---\nname: valid-name\ndescription: valid\n---\n# Content\nHere");
        const errors = validateSkill(p, "valid-name");
        expect(errors).toHaveLength(0);
    });

    test("CRLF frontmatter is accepted", () => {
        const p = join(fixturesDir, "crlf-valid.md");
        writeFileSync(p, "---\r\nname: valid-name\r\ndescription: valid\r\n---\r\n# Content\r\nHere");
        const errors = validateSkill(p, "valid-name");
        expect(errors).toHaveLength(0);
    });

    test("---invalid not being accepted as a closing delimiter", () => {
        const p = join(fixturesDir, "invalid-closing.md");
        writeFileSync(p, "---\nname: valid-name\ndescription: valid\n---invalid\n# Content");
        const errors = validateSkill(p, "valid-name");
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0].message).toContain("Frontmatter not closed");
    });

    test("missing closing delimiter", () => {
        const p = join(fixturesDir, "missing-closing.md");
        writeFileSync(p, "---\nname: valid-name\ndescription: valid\n# Content");
        const errors = validateSkill(p, "valid-name");
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0].message).toContain("Frontmatter not closed");
    });

    test("valid Markdown content after the frontmatter", () => {
        const p = join(fixturesDir, "content-after.md");
        writeFileSync(p, "---\nname: valid-name\ndescription: valid\n---\n# Content\nSome other text.");
        const errors = validateSkill(p, "valid-name");
        expect(errors).toHaveLength(0);
    });

    test("YAML multiline values that do not accidentally terminate the frontmatter", () => {
        const p = join(fixturesDir, "multiline-yaml.md");
        writeFileSync(p, "---\nname: valid-name\ndescription: |\n  valid\n  ---\n  not-delimiter\n---\n# Content");
        const errors = validateSkill(p, "valid-name");
        expect(errors).toHaveLength(0);
    });

    test("invalid non-string license", () => {
        const p = join(fixturesDir, "invalid-license.md");
        writeFileSync(p, "---\nname: valid-name\ndescription: valid\nlicense: 123\n---\n");
        const errors = validateSkill(p, "valid-name");
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some(e => e.message.includes("'license' must be a string"))).toBe(true);
    });

    test("invalid non-string compatibility", () => {
        const p = join(fixturesDir, "invalid-compatibility.md");
        writeFileSync(p, "---\nname: valid-name\ndescription: valid\ncompatibility: 1.0\n---\n");
        const errors = validateSkill(p, "valid-name");
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some(e => e.message.includes("'compatibility' must be a string"))).toBe(true);
    });

    test("non-object metadata", () => {
        const p = join(fixturesDir, "invalid-metadata.md");
        writeFileSync(p, "---\nname: valid-name\ndescription: valid\nmetadata: \"string-val\"\n---\n");
        const errors = validateSkill(p, "valid-name");
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some(e => e.message.includes("'metadata' must be an object"))).toBe(true);
    });

    test("metadata containing a non-string value", () => {
        const p = join(fixturesDir, "invalid-metadata-val.md");
        writeFileSync(p, "---\nname: valid-name\ndescription: valid\nmetadata: { key: 123 }\n---\n");
        const errors = validateSkill(p, "valid-name");
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some(e => e.message.includes("'metadata' values must be strings"))).toBe(true);
    });
    test("5. fixture without frontmatter is rejected", () => {
        const p = join(fixturesDir, "no-frontmatter.md");
        writeFileSync(p, "# Only Markdown\nNo frontmatter here.");
        const errors = validateSkill(p);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0].message).toContain("Missing initial '---'");
    });

    test("6. fixture with divergent name is rejected", () => {
        const p = join(fixturesDir, "divergent.md");
        writeFileSync(p, "---\nname: other-name\ndescription: valid\n---\n");
        const errors = validateSkill(p, "expected-name");
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some(e => e.message.includes("does not match directory name"))).toBe(true);
    });

    test("7. fixture with invalid name format is rejected", () => {
        const p = join(fixturesDir, "invalid-name.md");
        writeFileSync(p, "---\nname: INVALID_NAME!\ndescription: valid\n---\n");
        const errors = validateSkill(p, "INVALID_NAME!");
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some(e => e.message.includes("invalid (must match"))).toBe(true);
    });

    test("empty directory is rejected", () => {
        const p = join(fixturesDir, "empty-dir");
        mkdirSync(p, { recursive: true });
        const errors = validateAllSkills(p);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some(e => e.message.includes("Skills directory is empty") || e.message.includes("Skills directory has no skill folders"))).toBe(true);
    });

    test("name > 64 chars is rejected", () => {
        const p = join(fixturesDir, "long-name.md");
        writeFileSync(p, `---\nname: ${"a".repeat(65)}\ndescription: valid\n---\n`);
        const errors = validateSkill(p, "a".repeat(65));
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some(e => e.message.includes("name' length must be between 1 and 64 characters"))).toBe(true);
    });

    test("description > 1024 chars is rejected", () => {
        const p = join(fixturesDir, "long-desc.md");
        writeFileSync(p, `---\nname: valid-name\ndescription: ${"a".repeat(1025)}\n---\n`);
        const errors = validateSkill(p, "valid-name");
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some(e => e.message.includes("description' length must be between 1 and 1024 characters"))).toBe(true);
    });

    test("optional fields license, compatibility, metadata are accepted", () => {
        const p = join(fixturesDir, "optional-fields.md");
        writeFileSync(p, `---\nname: valid-name\ndescription: valid\nlicense: "MIT"\ncompatibility: "1.0"\nmetadata: {a: "1"}\n---\n`);
        const errors = validateSkill(p, "valid-name");
        expect(errors).toHaveLength(0);
    });

    test("invalid YAML produces explicit error", () => {
        const p = join(fixturesDir, "invalid-yaml.md");
        writeFileSync(p, `---\nname: valid\n  description: invalid indentation\n---\n`);
        const errors = validateSkill(p, "valid");
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some(e => e.message.includes("Invalid YAML frontmatter"))).toBe(true);
    });

    test("skill without SKILL.md produces error", () => {
        const p = join(fixturesDir, "no-skill-md-dir");
        mkdirSync(join(p, "valid-name"), { recursive: true });
        const errors = validateAllSkills(p);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some(e => e.message.includes("Skill directory without SKILL.md"))).toBe(true);
    });

    test("duplicate names produce error", () => {
        const p = join(fixturesDir, "duplicate-names");
        mkdirSync(join(p, "skill-a"), { recursive: true });
        mkdirSync(join(p, "skill-b"), { recursive: true });
        writeFileSync(join(p, "skill-a", "SKILL.md"), `---\nname: duplicate-name\ndescription: valid\n---\n`);
        writeFileSync(join(p, "skill-b", "SKILL.md"), `---\nname: duplicate-name\ndescription: valid\n---\n`);

        const errors = validateAllSkills(p);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some(e => e.message.includes("Duplicate skill name: duplicate-name"))).toBe(true);
    });
  });

  describe("Installation & Fallback", () => {
    const testProject = mkdtempSync(join(tmpdir(), 'temp-project-'));

    afterAll(() => {
        rmSync(testProject, { recursive: true, force: true });
    });

    test("8. /banca:init or installAssets() installs the 8 skills", () => {
        const installed = installAssets(testProject, true);
        expect(installed.length).toBeGreaterThan(0);

        const installedSkillsDir = join(testProject, ".dsh", "skills");
        expect(existsSync(installedSkillsDir)).toBe(true);

        // Comprovar exatamente os 8 diretórios
        const dirs = readdirSync(installedSkillsDir, { withFileTypes: true })
            .filter((d: any) => d.isDirectory())
            .map((d: any) => d.name);

        expect(dirs.length).toBe(8);
        expect([...dirs].sort()).toEqual([...EXPECTED_SKILLS].sort());

        // Nenhuma skill inesperada
        const unexpected = dirs.filter((d: string) => !EXPECTED_SKILLS.includes(d));
        expect(unexpected).toHaveLength(0);

        // Presença de SKILL.md, frontmatter válido e nome igual ao diretório
        for (const skill of EXPECTED_SKILLS) {
            const skillPath = join(installedSkillsDir, skill, "SKILL.md");
            expect(existsSync(skillPath)).toBe(true);
            const errors = validateSkill(skillPath, skill);
            expect(errors).toHaveLength(0);
        }
    });

    test("9. copied skills have valid frontmatter", () => {
        const p = mkdtempSync(join(tmpdir(), 'copied-skills-'));
        try {
            installAssets(p, true);
            const installedSkillsDir = join(p, ".dsh", "skills");
            const errors = validateAllSkills(installedSkillsDir);
            expect(errors).toHaveLength(0);
        } finally {
            rmSync(p, { recursive: true, force: true });
        }
    });

    test("fallback mechanism produces valid and exact skills", () => {
        const fallbackProject = mkdtempSync(join(tmpdir(), 'fallback-project-'));
        try {
            // Pass a non-existent dir to force fallback
            const nonExistentDir = join(__dirname, "does-not-exist");
            const installed = installAssets(fallbackProject, true, nonExistentDir);
            expect(installed.length).toBeGreaterThan(0);

            const installedSkillsDir = join(fallbackProject, ".dsh", "skills");
            const errors = validateAllSkills(installedSkillsDir);
            expect(errors).toHaveLength(0);

            // Compare each installed fallback SKILL.md with the versioned one
            const versionedSkillsDir = join(__dirname, "..", "assets", "dsh", "skills");
            for (const skill of EXPECTED_SKILLS) {
                const fallbackSkillPath = join(installedSkillsDir, skill, "SKILL.md");
                const versionedSkillPath = join(versionedSkillsDir, skill, "SKILL.md");

                expect(existsSync(fallbackSkillPath)).toBe(true);
                expect(existsSync(versionedSkillPath)).toBe(true);

                const fallbackContent = readFileSync(fallbackSkillPath, "utf-8").replace(/\r\n/g, "\n");
                const versionedContent = readFileSync(versionedSkillPath, "utf-8").replace(/\r\n/g, "\n");

                expect(fallbackContent).toBe(versionedContent);
            }
        } finally {
            rmSync(fallbackProject, { recursive: true, force: true });
        }
    });
  });

  describe("CLI Execution", () => {
    const scriptPath = join(__dirname, "..", "scripts", "validate-skills.ts");
    const cliFixturesDir = mkdtempSync(join(tmpdir(), "skills-cli-fixtures-"));

    afterAll(() => {
      rmSync(cliFixturesDir, { recursive: true, force: true });
    });

    function runCli(cwd: string, envOverrides: Record<string, string | undefined> = {}) {
      const env = { ...process.env, ...envOverrides };
      if (!("SKILLS_DIR" in envOverrides)) {
        delete env.SKILLS_DIR;
      }
      return spawnSync("bun", ["run", scriptPath], {
        cwd,
        env,
        encoding: "utf8",
      });
    }

    test("1. skills/ invalido + espelho valido -> FAIL", () => {
      const testDir = join(cliFixturesDir, "case1-invalid-canonical");
      const invalidSkillDir = join(testDir, "skills", "banca-avaliacao");
      const validMirrorDir = join(testDir, "assets", "dsh", "skills", "banca-avaliacao");
      mkdirSync(invalidSkillDir, { recursive: true });
      mkdirSync(validMirrorDir, { recursive: true });
      writeFileSync(join(invalidSkillDir, "SKILL.md"), "INVALID FRONTMATTER CONTENT");
      writeFileSync(
        join(validMirrorDir, "SKILL.md"),
        "---\nname: banca-avaliacao\ndescription: valid\n---\n# Valid"
      );

      const res = runCli(testDir);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain("Skill validation failed:");
    });

    test("2. skills/ valido + espelho invalido -> PASS", () => {
      const testDir = join(cliFixturesDir, "case2-valid-canonical");
      const validSkillDir = join(testDir, "skills", "banca-avaliacao");
      const invalidMirrorDir = join(testDir, "assets", "dsh", "skills", "banca-avaliacao");
      mkdirSync(validSkillDir, { recursive: true });
      mkdirSync(invalidMirrorDir, { recursive: true });
      writeFileSync(
        join(validSkillDir, "SKILL.md"),
        "---\nname: banca-avaliacao\ndescription: valid\n---\n# Valid"
      );
      writeFileSync(join(invalidMirrorDir, "SKILL.md"), "INVALID FRONTMATTER CONTENT");

      const res = runCli(testDir);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("All skills are valid.");
    });

    test("3. skills/ inexistente -> FAIL", () => {
      const testDir = join(cliFixturesDir, "case3-missing-canonical");
      mkdirSync(testDir, { recursive: true });

      const res = runCli(testDir);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain("Base directory does not exist");
    });

    test("4. diretorio vazio -> FAIL", () => {
      const testDir = join(cliFixturesDir, "case4-empty-canonical");
      mkdirSync(join(testDir, "skills"), { recursive: true });

      const res = runCli(testDir);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain("Skills directory is empty");
    });

    test("5. diretorio de skill sem SKILL.md -> FAIL", () => {
      const testDir = join(cliFixturesDir, "case5-no-skill-md");
      mkdirSync(join(testDir, "skills", "banca-avaliacao"), { recursive: true });

      const res = runCli(testDir);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain("Skill directory without SKILL.md");
    });

    test("6. oito skills reais validas em skills/ -> PASS (CLI default no repo root)", () => {
      const repoRoot = join(__dirname, "..");
      const res = runCli(repoRoot);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("All skills are valid.");
    });

    test("7. override explicito SKILLS_DIR -> mantem o comportamento previsto", () => {
      const repoRoot = join(__dirname, "..");

      // Override with valid directory
      const validRes = runCli(repoRoot, {
        SKILLS_DIR: join(repoRoot, "skills"),
      });
      expect(validRes.status).toBe(0);
      expect(validRes.stdout).toContain("All skills are valid.");

      // Override with mirror directory
      const mirrorRes = runCli(repoRoot, {
        SKILLS_DIR: join(repoRoot, "assets", "dsh", "skills"),
      });
      expect(mirrorRes.status).toBe(0);

      // Override with non-existent directory
      const invalidRes = runCli(repoRoot, {
        SKILLS_DIR: join(cliFixturesDir, "does-not-exist"),
      });
      expect(invalidRes.status).not.toBe(0);
      expect(invalidRes.stderr).toContain("Base directory does not exist");
    });
  });
});
