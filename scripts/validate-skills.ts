import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import * as yaml from "yaml";

interface ValidationError {
    file: string;
    message: string;
}

function parseSkillFrontmatter(file: string, content: string): { parsed: any, errors: ValidationError[] } {
    const errors: ValidationError[] = [];
    let startIndex = 0;
    if (content.startsWith("---\n")) {
        startIndex = 4;
    } else if (content.startsWith("---\r\n")) {
        startIndex = 5;
    } else {
        errors.push({ file, message: "Missing initial '---' delimiter" });
        return { parsed: null, errors };
    }

    // Capture closing delimiter dynamically. We want to stop at the start of the delimiter line.
    // The regex ensures it is preceded by a newline, followed by a newline or EOF.
    const match = content.match(/\n---(?:\r?\n|$)/);
    if (!match) {
        errors.push({ file, message: "Frontmatter not closed" });
        return { parsed: null, errors };
    }

    const endFrontmatter = match.index!;
    let frontmatter = content.substring(startIndex, endFrontmatter);
    // Remove any trailing \r if it was a CRLF file (match.index matches the \n, but previous character could be \r)
    if (frontmatter.endsWith("\r")) {
        frontmatter = frontmatter.slice(0, -1);
    }
    let parsed: any;
    try {
        parsed = yaml.parse(frontmatter);
    } catch (e: any) {
        errors.push({ file, message: `Invalid YAML frontmatter: ${e.message || e}` });
        return { parsed: null, errors };
    }

    if (!parsed || typeof parsed !== 'object') {
        errors.push({ file, message: "Frontmatter is not a YAML object" });
        return { parsed: null, errors };
    }

    return { parsed, errors };
}

export function validateSkill(file: string, expectedName?: string): ValidationError[] {
    const errors: ValidationError[] = [];
    let content = "";
    try {
        content = readFileSync(file, "utf8");
    } catch (e: any) {
        errors.push({ file, message: `Could not read file: ${e.message || e}` });
        return errors;
    }

    const { parsed, errors: parseErrors } = parseSkillFrontmatter(file, content);
    errors.push(...parseErrors);

    if (!parsed) return errors;

    if (!parsed.name) {
        errors.push({ file, message: "Missing 'name' in frontmatter" });
    } else if (typeof parsed.name !== "string") {
        errors.push({ file, message: "'name' must be a string" });
    } else {
        if (parsed.name.length < 1 || parsed.name.length > 64) {
             errors.push({ file, message: "'name' length must be between 1 and 64 characters" });
        }
        if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(parsed.name)) {
            errors.push({ file, message: "'name' is invalid (must match ^[a-z0-9]+(-[a-z0-9]+)*$)" });
        }
        if (expectedName && parsed.name !== expectedName) {
            errors.push({ file, message: `'name' in frontmatter (${parsed.name}) does not match directory name (${expectedName})` });
        }
    }

    if (!parsed.description) {
        errors.push({ file, message: "Missing 'description' in frontmatter" });
    } else if (typeof parsed.description !== "string") {
        errors.push({ file, message: "'description' must be a string" });
    } else {
        if (parsed.description.trim() === "") {
             errors.push({ file, message: "'description' is empty" });
        } else if (parsed.description.length < 1 || parsed.description.length > 1024) {
             errors.push({ file, message: "'description' length must be between 1 and 1024 characters" });
        }
    }

    if (parsed.license !== undefined && typeof parsed.license !== 'string') {
        errors.push({ file, message: "'license' must be a string" });
    }
    if (parsed.compatibility !== undefined && typeof parsed.compatibility !== 'string') {
        errors.push({ file, message: "'compatibility' must be a string" });
    }
    if (parsed.metadata !== undefined) {
        if (typeof parsed.metadata !== 'object' || Array.isArray(parsed.metadata) || parsed.metadata === null) {
            errors.push({ file, message: "'metadata' must be an object" });
        } else {
            for (const key of Object.keys(parsed.metadata)) {
                if (typeof parsed.metadata[key] !== 'string') {
                    errors.push({ file, message: "'metadata' values must be strings" });
                    break;
                }
            }
        }
    }

    // We simply ignore fields OpenCode doesn't know about or doesn't care about

    return errors;
}

export function validateAllSkills(baseDir: string): ValidationError[] {
    const errors: ValidationError[] = [];
    if (!existsSync(baseDir)) {
        errors.push({ file: baseDir, message: "Base directory does not exist" });
        return errors;
    }

    const entries = readdirSync(baseDir, { withFileTypes: true });

    if (entries.length === 0) {
        errors.push({ file: baseDir, message: "Skills directory is empty" });
        return errors;
    }

    const dirs = entries.filter(d => d.isDirectory()).map(d => d.name);

    if (dirs.length === 0) {
        errors.push({ file: baseDir, message: "Skills directory has no skill folders" });
        return errors;
    }

    const names = new Set<string>();

    for (const dir of dirs) {
        const skillDir = join(baseDir, dir);
        const skillFile = join(skillDir, "SKILL.md");

        if (!existsSync(skillFile)) {
             errors.push({ file: skillDir, message: "Skill directory without SKILL.md" });
             continue;
        }

        const fileErrors = validateSkill(skillFile, dir);
        errors.push(...fileErrors);

        // Check uniqueness based on parsed name
        let content = "";
        try {
             content = readFileSync(skillFile, "utf8");
             const { parsed } = parseSkillFrontmatter(skillFile, content);
             if (parsed && parsed.name) {
                 if (names.has(parsed.name)) {
                     errors.push({ file: skillFile, message: `Duplicate skill name: ${parsed.name}` });
                 }
                 names.add(parsed.name);
             }
        } catch(e: any) {
             errors.push({ file: skillFile, message: `Unexpected error reading file for duplication check: ${e.message || e}` });
        }
    }

    return errors;
}

if (import.meta.main) {
    const skillsDir = process.env.SKILLS_DIR || "skills";
    const errors = validateAllSkills(skillsDir);
    if (errors.length > 0) {
        console.error("Skill validation failed:");
        for (const err of errors) {
            console.error(`- ${err.file}: ${err.message}`);
        }
        process.exit(1);
    } else {
        console.log("All skills are valid.");
        process.exit(0);
    }
}
