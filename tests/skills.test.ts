import { describe, expect, test, beforeAll, afterAll, afterEach } from "bun:test";
import { join } from "path";
import { spawnSync } from "child_process";
import { tmpdir } from "os";
import { readFileSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync, mkdtempSync, symlinkSync, lstatSync } from "fs";
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

  test("mirror skills validation contract does not depend on physical assets/dsh/skills existence", () => {
    // Se o espelho legado existir na árvore durante a fase de transição, ele deve ser válido
    if (existsSync(versionedSkillsDir)) {
      const errors = validateAllSkills(versionedSkillsDir);
      expect(errors).toHaveLength(0);
    }
    // A validação da fonte canônica permanece autoritativa
    const canonicalErrors = validateAllSkills(canonicalSkillsDir);
    expect(canonicalErrors).toHaveLength(0);
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

            // Compare each installed fallback SKILL.md with the canonical one in skills/
            for (const skill of EXPECTED_SKILLS) {
                const fallbackSkillPath = join(installedSkillsDir, skill, "SKILL.md");
                const canonicalSkillPath = join(canonicalSkillsDir, skill, "SKILL.md");

                expect(existsSync(fallbackSkillPath)).toBe(true);
                expect(existsSync(canonicalSkillPath)).toBe(true);

                const fallbackContent = readFileSync(fallbackSkillPath, "utf-8").replace(/\r\n/g, "\n");
                const canonicalContent = readFileSync(canonicalSkillPath, "utf-8").replace(/\r\n/g, "\n");

                expect(fallbackContent).toBe(canonicalContent);

                const fallbackHash = new Bun.CryptoHasher("sha256").update(fallbackContent).digest("hex");
                const canonicalHash = new Bun.CryptoHasher("sha256").update(canonicalContent).digest("hex");
                expect(fallbackHash).toBe(canonicalHash);
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

      // Override with synthetic valid directory (does not depend on legacy mirror presence)
      const syntheticSkillsDir = join(cliFixturesDir, "synthetic-skills-override");
      for (const skill of EXPECTED_SKILLS) {
        const sDir = join(syntheticSkillsDir, skill);
        mkdirSync(sDir, { recursive: true });
        writeFileSync(join(sDir, "SKILL.md"), readFileSync(join(canonicalSkillsDir, skill, "SKILL.md")));
      }
      const mirrorRes = runCli(repoRoot, {
        SKILLS_DIR: syntheticSkillsDir,
      });
      expect(mirrorRes.status).toBe(0);
      expect(mirrorRes.stdout).toContain("All skills are valid.");

      // Override with non-existent directory
      const invalidRes = runCli(repoRoot, {
        SKILLS_DIR: join(cliFixturesDir, "does-not-exist"),
      });
      expect(invalidRes.status).not.toBe(0);
      expect(invalidRes.stderr).toContain("Base directory does not exist");
    });
  });

  describe("Canonical Skill Installer (#40)", () => {
    const canonicalSkillsDir = join(__dirname, "..", "skills");
    const testRoots: string[] = [];

    afterEach(() => {
      while (testRoots.length > 0) {
        const root = testRoots.pop();
        if (root && existsSync(root)) {
          rmSync(root, { recursive: true, force: true });
        }
      }
    });

    function tempDir(prefix: string): string {
      const dir = mkdtempSync(join(tmpdir(), prefix));
      testRoots.push(dir);
      return dir;
    }

    function projectInventory(root: string): Record<string, string> {
      const inventory: Record<string, string> = {};
      const walk = (directory: string, prefix = "") => {
        if (!existsSync(directory)) return;
        for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          const p = join(directory, entry.name);
          if (entry.isDirectory()) walk(p, rel);
          else inventory[rel] = entry.isFile() ? readFileSync(p, "utf8") : "<non-regular>";
        }
      };
      walk(root);
      return inventory;
    }

    test("A. Instalação normal: 8 skills com hashes idênticos aos arquivos canônicos", () => {
      const project = tempDir("case-a-normal-");
      const installed = installAssets(project, true);
      expect(installed.length).toBeGreaterThan(0);

      const installedSkillsDir = join(project, ".dsh", "skills");
      for (const skill of EXPECTED_SKILLS) {
        const installedPath = join(installedSkillsDir, skill, "SKILL.md");
        const canonicalPath = join(canonicalSkillsDir, skill, "SKILL.md");
        expect(existsSync(installedPath)).toBe(true);

        const installedHash = new Bun.CryptoHasher("sha256").update(readFileSync(installedPath)).digest("hex");
        const canonicalHash = new Bun.CryptoHasher("sha256").update(readFileSync(canonicalPath)).digest("hex");
        expect(installedHash).toBe(canonicalHash);
      }
    });

    test("B. Fallback sem assets: customAssetsDir inexistente ainda provê as 8 skills canônicas", () => {
      const project = tempDir("case-b-fallback-");
      const nonexistentAssets = join(project, "no-such-assets-dir");
      const installed = installAssets(project, true, nonexistentAssets);
      expect(installed.length).toBeGreaterThan(0);

      const installedSkillsDir = join(project, ".dsh", "skills");
      for (const skill of EXPECTED_SKILLS) {
        const installedPath = join(installedSkillsDir, skill, "SKILL.md");
        const canonicalPath = join(canonicalSkillsDir, skill, "SKILL.md");
        expect(existsSync(installedPath)).toBe(true);

        const installedHash = new Bun.CryptoHasher("sha256").update(readFileSync(installedPath)).digest("hex");
        const canonicalHash = new Bun.CryptoHasher("sha256").update(readFileSync(canonicalPath)).digest("hex");
        expect(installedHash).toBe(canonicalHash);
      }

      // Provar eliminação da constante duplicada SKILLS no código fonte
      const installerSource = readFileSync(join(__dirname, "..", "src", "lib", "install_assets.ts"), "utf8");
      expect(installerSource).not.toMatch(/\bconst\s+SKILLS\b/);
    });

    test("C. Fonte canônica inválida com espelho válido: instalação rejeitada", () => {
      const project = tempDir("case-c-invalid-canonical-");
      const invalidCanonical = tempDir("invalid-canonical-skills-");

      // Criar 7 skills válidas e 1 ausente
      for (const skill of EXPECTED_SKILLS.slice(1)) {
        const sDir = join(invalidCanonical, skill);
        mkdirSync(sDir, { recursive: true });
        writeFileSync(join(sDir, "SKILL.md"), readFileSync(join(canonicalSkillsDir, skill, "SKILL.md")));
      }

      const before = projectInventory(project);
      expect(() => {
        // Passar canonical dir inválido (4º argumento)
        (installAssets as any)(project, true, undefined, invalidCanonical);
      }).toThrow(/canonical skill.*missing|canonical skills directory/i);

      expect(projectInventory(project)).toEqual(before);

      // Agora com SKILL.md com frontmatter inválido
      const corruptCanonical = tempDir("corrupt-canonical-skills-");
      for (const skill of EXPECTED_SKILLS) {
        const sDir = join(corruptCanonical, skill);
        mkdirSync(sDir, { recursive: true });
        if (skill === "banca-avaliacao") {
          writeFileSync(join(sDir, "SKILL.md"), "NO_FRONTMATTER_CORRUPT_SKILL");
        } else {
          writeFileSync(join(sDir, "SKILL.md"), readFileSync(join(canonicalSkillsDir, skill, "SKILL.md")));
        }
      }

      expect(() => {
        (installAssets as any)(project, true, undefined, corruptCanonical);
      }).toThrow(/canonical skill.*frontmatter|invalid/i);
    });

    test("D. Espelho divergente com canônica válida: instalador não usa o espelho divergente", () => {
      const project = tempDir("case-d-mirror-divergent-");
      const customAssets = tempDir("custom-assets-with-tampered-mirror-");

      // Copiar agents, commands, templates válidos
      const defaultAssets = join(__dirname, "..", "assets");
      mkdirSync(join(customAssets, "dsh", "agents"), { recursive: true });
      mkdirSync(join(customAssets, "dsh", "commands"), { recursive: true });
      mkdirSync(join(customAssets, "templates"), { recursive: true });

      for (const agent of readdirSync(join(defaultAssets, "dsh", "agents"))) {
        writeFileSync(join(customAssets, "dsh", "agents", agent), readFileSync(join(defaultAssets, "dsh", "agents", agent)));
      }
      for (const cmd of readdirSync(join(defaultAssets, "dsh", "commands"))) {
        writeFileSync(join(customAssets, "dsh", "commands", cmd), readFileSync(join(defaultAssets, "dsh", "commands", cmd)));
      }
      for (const tpl of readdirSync(join(defaultAssets, "templates"))) {
        writeFileSync(join(customAssets, "templates", tpl), readFileSync(join(defaultAssets, "templates", tpl)));
      }

      // Adicionar espelho adulterado em dsh/skills
      mkdirSync(join(customAssets, "dsh", "skills", "banca-avaliacao"), { recursive: true });
      writeFileSync(
        join(customAssets, "dsh", "skills", "banca-avaliacao", "SKILL.md"),
        "---\nname: banca-avaliacao\ndescription: TAMPERED_MIRROR_SKILL\n---\n# Tampered Content\n",
      );

      installAssets(project, true, customAssets);

      const installedSkill = readFileSync(join(project, ".dsh", "skills", "banca-avaliacao", "SKILL.md"), "utf8");
      expect(installedSkill).not.toContain("TAMPERED_MIRROR_SKILL");
      expect(installedSkill).not.toContain("Tampered Content");

      const canonicalSkill = readFileSync(join(canonicalSkillsDir, "banca-avaliacao", "SKILL.md"), "utf8");
      expect(installedSkill).toBe(canonicalSkill);
    });

    test("E. Assets incompletos: falha controlada antes de modificações parciais", () => {
      const project = tempDir("case-e-incomplete-assets-");
      const incompleteAssets = tempDir("incomplete-assets-dir-");
      // Cria diretório dsh/agents vazio (sem banca-auditor.md nem outros agents)
      mkdirSync(join(incompleteAssets, "dsh", "agents"), { recursive: true });

      const before = projectInventory(project);
      expect(() => {
        installAssets(project, true, incompleteAssets);
      }).toThrow(/incomplete|missing/i);

      expect(projectInventory(project)).toEqual(before);
    });

    test("F. Symlinks e paths protegidos: bloqueio sem escrita externa", () => {
      const project = tempDir("case-f-symlink-proj-");
      const external = tempDir("case-f-external-");

      // Destino .dsh/skills symlink para fora
      mkdirSync(join(project, ".dsh"), { recursive: true });
      const externalSkills = join(external, "external-skills");
      mkdirSync(externalSkills, { recursive: true });
      const destSkills = join(project, ".dsh", "skills");
      symlinkSync(externalSkills, destSkills);

      const extBefore = projectInventory(external);
      expect(() => installAssets(project, true)).toThrow();
      expect(projectInventory(external)).toEqual(extBefore);

      // Symlink em skill file individual
      const project2 = tempDir("case-f-symlink-file-");
      const extFile = join(external, "target-skill.md");
      writeFileSync(extFile, "EXTERNAL_ORIGINAL_CONTENT");
      mkdirSync(join(project2, ".dsh", "skills", "banca-avaliacao"), { recursive: true });
      symlinkSync(extFile, join(project2, ".dsh", "skills", "banca-avaliacao", "SKILL.md"));

      expect(() => installAssets(project2, true)).toThrow(/must be a regular file|escapes workspace root/i);
      expect(readFileSync(extFile, "utf8")).toBe("EXTERNAL_ORIGINAL_CONTENT");
    });

    test("G. Instalação repetida, idempotência e proteção contra sobrescrita de dados do usuário", () => {
      const project = tempDir("case-g-idempotence-");

      // 1ª execução
      const firstRun = installAssets(project, false);
      expect(firstRun.length).toBeGreaterThan(0);

      // 2ª execução sem force -> idempotente
      const secondRun = installAssets(project, false);
      expect(secondRun.length).toBe(0);

      // Simular arquivo de skill customizado pelo usuário (drift)
      const customizedSkill = join(project, ".dsh", "skills", "banca-avaliacao", "SKILL.md");
      writeFileSync(customizedSkill, "---\nname: banca-avaliacao\ndescription: USER_CUSTOMIZED\n---\n# User\n");

      // Tentativa com force: false -> bloqueado
      expect(() => installAssets(project, false)).toThrow(/differs from the canonical source/i);
      expect(readFileSync(customizedSkill, "utf8")).toContain("USER_CUSTOMIZED");

      // Tentativa com force: true -> TAMBÉM bloqueado (force não autoriza sobrescrever dados do usuário)
      expect(() => installAssets(project, true)).toThrow(/differs from the canonical source/i);
      expect(readFileSync(customizedSkill, "utf8")).toContain("USER_CUSTOMIZED");

      // Adicionar skill customizada do usuário no workspace (.dsh/skills/minha-skill/SKILL.md)
      // Deve ser preservada sem ser apagada
      const customUserSkillDir = join(project, ".dsh", "skills", "minha-skill");
      mkdirSync(customUserSkillDir, { recursive: true });
      const customUserSkillFile = join(customUserSkillDir, "SKILL.md");
      writeFileSync(customUserSkillFile, "---\nname: minha-skill\ndescription: custom\n---\n# Custom\n");

      // Restaurar banca-avaliacao para o canônico para testar preservação de custom-skill
      writeFileSync(customizedSkill, readFileSync(join(canonicalSkillsDir, "banca-avaliacao", "SKILL.md")));

      installAssets(project, false);
      expect(existsSync(customUserSkillFile)).toBe(true);
      expect(readFileSync(customUserSkillFile, "utf8")).toContain("minha-skill");
    });

    test("H. Empacotamento: pacote construído contém a fonte canônica e instalador resolve em dist", () => {
      const project = tempDir("case-h-pack-");

      // Compilar dist
      const buildRes = spawnSync("bun", ["run", "build"], { cwd: join(__dirname, ".."), encoding: "utf8" });
      expect(buildRes.status).toBe(0);

      // Verificar que dist/lib/install_assets.js existe
      const distInstaller = join(__dirname, "..", "dist", "lib", "install_assets.js");
      expect(existsSync(distInstaller)).toBe(true);

      // Verificar arquivos incluídos no pacote via npm pack --dry-run --json
      const packRes = spawnSync("npm", ["pack", "--dry-run", "--json"], { cwd: join(__dirname, ".."), encoding: "utf8" });
      expect(packRes.status).toBe(0);
      const [packInfo] = JSON.parse(packRes.stdout);
      const packedPaths = new Set(packInfo.files.map((f: any) => f.path));
      for (const skill of EXPECTED_SKILLS) {
        expect(packedPaths.has(`skills/${skill}/SKILL.md`)).toBe(true);
      }

      // Executar instalador a partir de dist/lib/install_assets.js
      const distModule = require(distInstaller);
      const installed = distModule.installAssets(project, true);
      expect(installed.length).toBeGreaterThan(0);

      for (const skill of EXPECTED_SKILLS) {
        const installedPath = join(project, ".dsh", "skills", skill, "SKILL.md");
        expect(existsSync(installedPath)).toBe(true);
        const installedHash = new Bun.CryptoHasher("sha256").update(readFileSync(installedPath)).digest("hex");
        const canonicalHash = new Bun.CryptoHasher("sha256").update(readFileSync(join(canonicalSkillsDir, skill, "SKILL.md"))).digest("hex");
        expect(installedHash).toBe(canonicalHash);
      }
    });

    test("I. Reversibilidade comprovada em fixture: estado anterior, instalação canônica e reversão verificada", () => {
      const project = tempDir("case-i-reversibility-");

      // 1. Estado anterior da instalação em fixture
      const initialInventory = projectInventory(project);
      expect(Object.keys(initialInventory)).toHaveLength(0);

      // 2. Instalação canônica
      const installed = installAssets(project, false);
      expect(installed.length).toBeGreaterThan(0);

      // 3. Verificação de conteúdo e fingerprints das 8 skills
      const installedFingerprints: Record<string, string> = {};
      for (const skill of EXPECTED_SKILLS) {
        const skillPath = join(project, ".dsh", "skills", skill, "SKILL.md");
        expect(existsSync(skillPath)).toBe(true);
        const hash = new Bun.CryptoHasher("sha256").update(readFileSync(skillPath)).digest("hex");
        installedFingerprints[skill] = hash;
        const canonicalHash = new Bun.CryptoHasher("sha256").update(readFileSync(join(canonicalSkillsDir, skill, "SKILL.md"))).digest("hex");
        expect(hash).toBe(canonicalHash);
      }

      // 4. Procedimento de reversão: remoção controlada dos assets instalados
      for (const path of installed) {
        if (existsSync(path)) {
          rmSync(path, { force: true });
        }
      }
      rmSync(join(project, ".dsh"), { recursive: true, force: true });
      rmSync(join(project, ".banca"), { recursive: true, force: true });

      // 5. Verificação de restauração do estado inicial
      const finalInventory = projectInventory(project);
      expect(finalInventory).toEqual(initialInventory);
    });

    test("J. Preflight YAML estrito: rejeita YAML malformado sem escritas no workspace (src e dist)", () => {
      const project = tempDir("case-j-yaml-project-");
      const tempCanonical = tempDir("case-j-canonical-skills-");

      // Copiar 8 skills válidas
      for (const skill of EXPECTED_SKILLS) {
        mkdirSync(join(tempCanonical, skill), { recursive: true });
        writeFileSync(join(tempCanonical, skill, "SKILL.md"), readFileSync(join(canonicalSkillsDir, skill, "SKILL.md")));
      }

      // Injetar YAML sintaticamente inválido (unterminated sequence) em banca-avaliacao
      const malformedYaml = "---\nname: banca-avaliacao\ndescription: valid\nmetadata: [unterminated\n---\n# body\n";
      writeFileSync(join(tempCanonical, "banca-avaliacao", "SKILL.md"), malformedYaml);

      // 1. Validador oficial rejeita a skill malformada
      const valErrors = validateSkill(join(tempCanonical, "banca-avaliacao", "SKILL.md"), "banca-avaliacao");
      expect(valErrors.length).toBeGreaterThan(0);
      expect(valErrors.some((e: any) => e.message.includes("Invalid YAML frontmatter") || e.message.includes("YAML"))).toBe(true);

      // 2 & 3. Instalador em src/ rejeita e workspace permanece intocado
      const beforeSrc = projectInventory(project);
      expect(() => {
        installAssets(project, true, undefined, tempCanonical);
      }).toThrow(/invalid.*frontmatter|YAML/i);
      expect(projectInventory(project)).toEqual(beforeSrc);

      // 4. Espelho (mesmo sintético válido) não mascara a falha de preflight da fonte canônica
      const syntheticAssetsWithMirror = tempDir("synthetic-assets-valid-mirror-");
      mkdirSync(join(syntheticAssetsWithMirror, "dsh", "agents"), { recursive: true });
      mkdirSync(join(syntheticAssetsWithMirror, "dsh", "commands"), { recursive: true });
      mkdirSync(join(syntheticAssetsWithMirror, "templates"), { recursive: true });
      const defaultAssets = join(__dirname, "..", "assets");
      for (const agent of readdirSync(join(defaultAssets, "dsh", "agents"))) {
        writeFileSync(join(syntheticAssetsWithMirror, "dsh", "agents", agent), readFileSync(join(defaultAssets, "dsh", "agents", agent)));
      }
      for (const cmd of readdirSync(join(defaultAssets, "dsh", "commands"))) {
        writeFileSync(join(syntheticAssetsWithMirror, "dsh", "commands", cmd), readFileSync(join(defaultAssets, "dsh", "commands", cmd)));
      }
      for (const tpl of readdirSync(join(defaultAssets, "templates"))) {
        writeFileSync(join(syntheticAssetsWithMirror, "templates", tpl), readFileSync(join(defaultAssets, "templates", tpl)));
      }
      mkdirSync(join(syntheticAssetsWithMirror, "dsh", "skills", "banca-avaliacao"), { recursive: true });
      writeFileSync(join(syntheticAssetsWithMirror, "dsh", "skills", "banca-avaliacao", "SKILL.md"), readFileSync(join(canonicalSkillsDir, "banca-avaliacao", "SKILL.md")));

      expect(() => {
        installAssets(project, true, syntheticAssetsWithMirror, tempCanonical);
      }).toThrow(/invalid.*frontmatter|YAML/i);
      expect(existsSync(join(project, ".dsh"))).toBe(false);

      // 6. Instalação em dist/ também rejeita igualmente sem modificar workspace
      const distInstaller = join(__dirname, "..", "dist", "lib", "install_assets.js");
      if (existsSync(distInstaller)) {
        const distModule = require(distInstaller);
        const beforeDist = projectInventory(project);
        expect(() => {
          distModule.installAssets(project, true, undefined, tempCanonical);
        }).toThrow(/invalid.*frontmatter|YAML/i);
        expect(projectInventory(project)).toEqual(beforeDist);
      }

      // 5. Oito skills válidas (restaurando banca-avaliacao) continuam sendo instaladas com sucesso
      writeFileSync(
        join(tempCanonical, "banca-avaliacao", "SKILL.md"),
        readFileSync(join(canonicalSkillsDir, "banca-avaliacao", "SKILL.md")),
      );
      const installed = installAssets(project, true, undefined, tempCanonical);
      expect(installed.length).toBeGreaterThan(0);

      const installedSkillsDir = join(project, ".dsh", "skills");
      for (const skill of EXPECTED_SKILLS) {
        const installedPath = join(installedSkillsDir, skill, "SKILL.md");
        expect(existsSync(installedPath)).toBe(true);
        const installedHash = new Bun.CryptoHasher("sha256").update(readFileSync(installedPath)).digest("hex");
        const canonicalHash = new Bun.CryptoHasher("sha256").update(readFileSync(join(canonicalSkillsDir, skill, "SKILL.md"))).digest("hex");
        expect(installedHash).toBe(canonicalHash);
      }
    });

    test("K. Pacote isolado de produção: resolução offline sem rede, instalação válida e preflight fail-closed", () => {
      const packDir = tempDir("case-k-pack-");
      const extractDir = tempDir("case-k-extract-");

      // 1. Empacotar via npm pack --ignore-scripts --offline
      const packRes = spawnSync("npm", [
        "pack",
        "--ignore-scripts",
        "--offline",
        "--pack-destination",
        packDir,
        "--json",
      ], {
        cwd: join(__dirname, ".."),
        encoding: "utf8",
        timeout: 15000,
      });
      expect(packRes.status).toBe(0);

      const [packInfo] = JSON.parse(packRes.stdout);
      const tarballPath = join(packDir, packInfo.filename);
      expect(existsSync(tarballPath)).toBe(true);

      // 2. Extrair tarball no diretório isolado
      const tarRes = spawnSync("tar", ["-xzf", tarballPath, "-C", extractDir], {
        encoding: "utf8",
        timeout: 10000,
      });
      expect(tarRes.status).toBe(0);

      const pkgRoot = join(extractDir, "package");
      expect(existsSync(pkgRoot)).toBe(true);

      // 3. Confirmar que package.json declara yaml em dependencies
      const pkgJson = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"));
      expect(pkgJson.dependencies?.yaml).toBe("2.7.0");
      expect(pkgJson.devDependencies?.yaml).toBeUndefined();

      // Copiar bun.lock para permitir instalação estritamente offline congelada
      writeFileSync(join(pkgRoot, "bun.lock"), readFileSync(join(__dirname, "..", "bun.lock")));

      // 4. Instalar estritamente apenas dependências de produção de forma offline, sem scripts externos e com timeout
      const installRes = spawnSync("bun", [
        "install",
        "--production",
        "--frozen-lockfile",
        "--offline",
        "--ignore-scripts",
      ], {
        cwd: pkgRoot,
        encoding: "utf8",
        timeout: 15000,
      });

      if (installRes.status !== 0 && installRes.stderr?.includes("is not in the cache")) {
        throw new Error(
          "BLOCKED: Cache offline local do Bun não contém yaml@2.7.0 ou zod@4.1.8. Provisione com 'bun install' antes da execução hermética."
        );
      }
      expect(installRes.status).toBe(0);

      // Confirmar que apenas dependências de produção estão presentes em node_modules
      const nodeModulesDir = join(pkgRoot, "node_modules");
      expect(existsSync(join(nodeModulesDir, "yaml"))).toBe(true);
      expect(existsSync(join(nodeModulesDir, "zod"))).toBe(true);
      expect(existsSync(join(nodeModulesDir, "typescript"))).toBe(false);
      expect(existsSync(join(nodeModulesDir, "@types"))).toBe(false);

      // 5. Executar Node.js nativo para testar resolução de yaml, importação e fail-closed
      const nodeTestScript = `
        import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
        import { join, resolve } from "node:path";

        // Import do validador e instalador
        const { validateSkill, validateSkillContent, validateAllSkills } = await import("./dist/lib/skill_validator.js");
        if (typeof validateSkill !== "function" || typeof validateAllSkills !== "function") {
          throw new Error("skill_validator export error");
        }

        const { installAssets } = await import("./dist/lib/install_assets.js");
        if (typeof installAssets !== "function") {
          throw new Error("installAssets export error");
        }

        const testProj = resolve("./test-workspace");
        const testCanonical = resolve("./test-canonical");
        mkdirSync(testProj, { recursive: true });
        mkdirSync(testCanonical, { recursive: true });

        const skills = [
          "banca-avaliacao", "banca-correcao", "banca-detector-ia", "banca-grille",
          "banca-plagio", "banca-planejador", "banca-referencias", "banca-revisor"
        ];

        // Copiar 8 skills válidas do pacote distribuído
        for (const s of skills) {
          mkdirSync(join(testCanonical, s), { recursive: true });
          writeFileSync(join(testCanonical, s, "SKILL.md"), readFileSync(join("./skills", s, "SKILL.md")));
        }

        // Caso positivo: instala 8 skills
        const installed = installAssets(testProj, true, undefined, testCanonical);
        if (installed.length === 0) throw new Error("installAssets installed 0 assets");

        for (const s of skills) {
          const dest = join(testProj, ".dsh", "skills", s, "SKILL.md");
          if (!existsSync(dest)) throw new Error("Missing installed skill: " + s);
        }

        // Caso negativo: preflight fail-closed em YAML malformado
        const badProj = resolve("./test-bad-workspace");
        mkdirSync(badProj, { recursive: true });
        writeFileSync(
          join(testCanonical, "banca-avaliacao", "SKILL.md"),
          "---\\nname: banca-avaliacao\\ndescription: valid\\nmetadata: [unterminated\\n---\\n# body\\n"
        );

        let rejected = false;
        try {
          installAssets(badProj, true, undefined, testCanonical);
        } catch (err) {
          rejected = true;
          if (!/invalid.*frontmatter|YAML/i.test(err.message)) {
            throw new Error("Unexpected error message: " + err.message);
          }
        }
        if (!rejected) throw new Error("Failed to reject malformed YAML in production package");
        if (existsSync(join(badProj, ".dsh"))) throw new Error("Workspace modified on failure!");

        console.log("CASE_K_NODE_SUCCESS");
      `;

      const nodeRun = spawnSync("node", ["--input-type=module", "-e", nodeTestScript], {
        cwd: pkgRoot,
        encoding: "utf8",
        timeout: 15000,
      });
      expect(nodeRun.status).toBe(0);
      expect(nodeRun.stdout).toContain("CASE_K_NODE_SUCCESS");

      // 6. Prova de timeout efetivo e encerramento controlado de subprocessos travados
      const hangStart = Date.now();
      const hangRes = spawnSync("node", ["-e", "setTimeout(() => {}, 60000)"], {
        timeout: 200,
        encoding: "utf8",
      });
      const elapsed = Date.now() - hangStart;
      expect(elapsed).toBeLessThan(5000);
      expect(hangRes.error?.name === "Error" || hangRes.signal === "SIGTERM" || hangRes.status !== 0).toBe(true);
    });

    test("L. Pacote sem espelho legado: funcionamento autônomo, instalador canônico e validação hermética", () => {
      const packDir = tempDir("case-l-pack-");
      const extractDir = tempDir("case-l-extract-");

      // 1. Gerar pacote isolado via npm pack --ignore-scripts --offline
      const packRes = spawnSync("npm", [
        "pack",
        "--ignore-scripts",
        "--offline",
        "--pack-destination",
        packDir,
        "--json",
      ], {
        cwd: join(__dirname, ".."),
        encoding: "utf8",
        timeout: 15000,
      });
      expect(packRes.status).toBe(0);

      const [packInfo] = JSON.parse(packRes.stdout);
      const tarballPath = join(packDir, packInfo.filename);
      expect(existsSync(tarballPath)).toBe(true);

      const tarRes = spawnSync("tar", ["-xzf", tarballPath, "-C", extractDir], {
        encoding: "utf8",
        timeout: 10000,
      });
      expect(tarRes.status).toBe(0);

      const pkgRoot = join(extractDir, "package");
      expect(existsSync(pkgRoot)).toBe(true);

      // Simular a exclusão definitiva do espelho legado no pacote distribuído
      const mirrorInPkg = join(pkgRoot, "assets", "dsh", "skills");
      if (existsSync(mirrorInPkg)) {
        rmSync(mirrorInPkg, { recursive: true, force: true });
      }
      expect(existsSync(mirrorInPkg)).toBe(false);

      // 1. O pacote contém as oito skills canônicas
      const pkgSkillsDir = join(pkgRoot, "skills");
      expect(existsSync(pkgSkillsDir)).toBe(true);
      for (const skill of EXPECTED_SKILLS) {
        const skillPath = join(pkgSkillsDir, skill, "SKILL.md");
        expect(existsSync(skillPath)).toBe(true);
        expect(lstatSync(skillPath).isFile()).toBe(true);
      }

      // 2. O validador reconhece as oito skills
      const valErrors = validateAllSkills(pkgSkillsDir);
      expect(valErrors).toHaveLength(0);

      // 3. O instalador funciona normalmente a partir da fonte canônica
      const testWorkspace = tempDir("case-l-workspace-");
      const installed = installAssets(testWorkspace, true, undefined, pkgSkillsDir);
      expect(installed.length).toBeGreaterThan(0);
      for (const skill of EXPECTED_SKILLS) {
        expect(existsSync(join(testWorkspace, ".dsh", "skills", skill, "SKILL.md"))).toBe(true);
      }

      // 4. O fallback continua funcional mesmo quando assetsDir não existe
      const fallbackWorkspace = tempDir("case-l-fallback-workspace-");
      const fallbackInstalled = installAssets(
        fallbackWorkspace,
        true,
        join(pkgRoot, "non-existent-assets-dir"),
        pkgSkillsDir
      );
      expect(fallbackInstalled.length).toBeGreaterThan(0);
      for (const skill of EXPECTED_SKILLS) {
        expect(existsSync(join(fallbackWorkspace, ".dsh", "skills", skill, "SKILL.md"))).toBe(true);
      }

      // 5. Os arquivos instalados possuem hashes SHA-256 idênticos aos canônicos
      const EXPECTED_HASHES: Record<string, string> = {
        "banca-avaliacao": "60bdcd97061da7748f7d1f9d6d7999fd62afac9b1269bf089eb23da7aab7c85e",
        "banca-correcao": "d0a05d3feb78f5ef05615a48892b3c5cdc88fc589b3fc2100f2d78a0a32d45c7",
        "banca-detector-ia": "db296d3e384e809847b2398638d55c2bcf62e092c2058943013a7523cb1b6a4b",
        "banca-grille": "c22d6bd6598117c491176fd1366c9c3974104bc3a349ebe791b1051f79682aa1",
        "banca-plagio": "1159f65153fad06086fa0debefe41a567cf895d251b1dd4f52a2849ae1146661",
        "banca-planejador": "d39405b0333e53eabd616104d4387dd0f77c26d505d63bed9094a8ae254eac64",
        "banca-referencias": "b5b73abbbae029adc82980b2045c705b091b1629a44d14efab92aa731008d36b",
        "banca-revisor": "deb90fe58a8d334bddd9f4dc66810cb5c57621cc63bad313c44c199c042de798",
      };

      for (const skill of EXPECTED_SKILLS) {
        const installedPath = join(testWorkspace, ".dsh", "skills", skill, "SKILL.md");
        const canonicalPath = join(pkgSkillsDir, skill, "SKILL.md");
        const installedHash = new Bun.CryptoHasher("sha256").update(readFileSync(installedPath)).digest("hex");
        const canonicalHash = new Bun.CryptoHasher("sha256").update(readFileSync(canonicalPath)).digest("hex");

        expect(installedHash).toBe(canonicalHash);
        expect(installedHash).toBe(EXPECTED_HASHES[skill]);
      }

      // 6 & 7. Parser YAML funciona em Node ESM e produção não depende de devDependencies
      writeFileSync(join(pkgRoot, "bun.lock"), readFileSync(join(__dirname, "..", "bun.lock")));
      const installRes = spawnSync("bun", [
        "install",
        "--production",
        "--frozen-lockfile",
        "--offline",
        "--ignore-scripts",
      ], {
        cwd: pkgRoot,
        encoding: "utf8",
        timeout: 15000,
      });

      if (installRes.status !== 0 && installRes.stderr?.includes("is not in the cache")) {
        throw new Error(
          "BLOCKED: Cache offline local do Bun não contém dependências de produção. Provisione com 'bun install' antes da execução hermética."
        );
      }
      expect(installRes.status).toBe(0);

      const nodeModulesDir = join(pkgRoot, "node_modules");
      expect(existsSync(join(nodeModulesDir, "yaml"))).toBe(true);
      expect(existsSync(join(nodeModulesDir, "zod"))).toBe(true);
      expect(existsSync(join(nodeModulesDir, "typescript"))).toBe(false);
      expect(existsSync(join(nodeModulesDir, "@types"))).toBe(false);

      const nodeTestScript = `
        import { existsSync, readFileSync, mkdirSync } from "node:fs";
        import { join, resolve } from "node:path";
        const { validateSkill, validateAllSkills } = await import("./dist/lib/skill_validator.js");
        const errors = validateAllSkills("./skills");
        if (errors.length !== 0) throw new Error("ESM validation failed: " + errors.length + " errors");

        const { installAssets } = await import("./dist/lib/install_assets.js");
        const esmWorkspace = resolve("./esm-workspace");
        mkdirSync(esmWorkspace, { recursive: true });
        const installed = installAssets(esmWorkspace, true);
        if (installed.length === 0) throw new Error("ESM installAssets installed 0 assets");
        if (!existsSync(join(esmWorkspace, ".dsh", "skills", "banca-avaliacao", "SKILL.md"))) {
          throw new Error("Missing installed banca-avaliacao in ESM");
        }
        console.log("CASE_L_NODE_SUCCESS");
      `;

      const nodeRun = spawnSync("node", ["--input-type=module", "-e", nodeTestScript], {
        cwd: pkgRoot,
        encoding: "utf8",
        timeout: 15000,
      });
      expect(nodeRun.status).toBe(0);
      expect(nodeRun.stdout).toContain("CASE_L_NODE_SUCCESS");

      // 8. A ausência do espelho não provoca fallback silencioso para conteúdo embutido
      const customModifiedDir = tempDir("case-l-custom-modified-skills-");
      for (const skill of EXPECTED_SKILLS) {
        const sDir = join(customModifiedDir, skill);
        mkdirSync(sDir, { recursive: true });
        let content = readFileSync(join(pkgSkillsDir, skill, "SKILL.md"), "utf8");
        if (skill === "banca-avaliacao") {
          content = content.replace("# Skill: Banca Avaliação", "# Skill: Banca Avaliação (Dynamic Custom Content)");
        }
        writeFileSync(join(sDir, "SKILL.md"), content);
      }

      const customWorkspace = tempDir("case-l-custom-workspace-");
      installAssets(customWorkspace, true, undefined, customModifiedDir);
      const customInstalledContent = readFileSync(
        join(customWorkspace, ".dsh", "skills", "banca-avaliacao", "SKILL.md"),
        "utf8"
      );
      expect(customInstalledContent).toContain("(Dynamic Custom Content)");

      // Reversibilidade comprovada da fixture: restaurar o espelho na fixture sintética se necessário
      mkdirSync(mirrorInPkg, { recursive: true });
      for (const skill of EXPECTED_SKILLS) {
        const sDir = join(mirrorInPkg, skill);
        mkdirSync(sDir, { recursive: true });
        writeFileSync(join(sDir, "SKILL.md"), readFileSync(join(pkgSkillsDir, skill, "SKILL.md")));
      }
      expect(existsSync(join(mirrorInPkg, "banca-avaliacao", "SKILL.md"))).toBe(true);
    });
  });
});
