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
  const versionedSkillsDir = join(__dirname, "..", "assets", "dsh", "skills");

  test("1 & 2. all versioned skills are valid and names match directories", () => {
    const errors = validateAllSkills(versionedSkillsDir);
    expect(errors).toHaveLength(0);
  });

  test("3. all names are unique", () => {
    const errors = validateAllSkills(versionedSkillsDir);
    const duplicates = errors.filter(e => e.message.includes("Duplicate skill name"));
    expect(duplicates).toHaveLength(0);
  });

  test("4. all have valid description", () => {
     const errors = validateAllSkills(versionedSkillsDir);
     const descErrors = errors.filter(e => e.message.includes("description"));
     expect(descErrors).toHaveLength(0);
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
    test("valid directory exits with 0", () => {
        const result = spawnSync("bun", ["run", "scripts/validate-skills.ts"], {
            env: { ...process.env, SKILLS_DIR: join(__dirname, "..", "assets", "dsh", "skills") }
        });
        expect(result.status).toBe(0);
    });

    test("invalid directory exits with non-zero", () => {
        const result = spawnSync("bun", ["run", "scripts/validate-skills.ts"], {
            env: { ...process.env, SKILLS_DIR: join(__dirname, "does-not-exist") }
        });
        expect(result.status).not.toBe(0);
    });
  });
});
