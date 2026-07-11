import { readFileSync, readdirSync, existsSync } from "fs";
import { join, parse } from "path";
import yaml from "yaml";

const EXPECTED_AGENTS = new Set([
  "banca-auditor",
  "banca-corretor",
  "banca-fontes",
  "banca-integrador",
  "banca-loop"
]);

export function validateAgent(filePath: string, expectedName?: string): string[] {
  const errors: string[] = [];
  const file = parse(filePath).base;
  const agentName = parse(filePath).name;

  if (expectedName && agentName !== expectedName) {
    errors.push(`Expected agent name '${expectedName}' but found '${agentName}' in ${file}`);
  }

  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (err: any) {
    errors.push(`Could not read file ${file}: ${err.message}`);
    return errors;
  }

  // Find frontmatter
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    errors.push(`Missing frontmatter opening delimiter in ${file}`);
    return errors;
  }

  const lines = content.split(/\r?\n/);
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      endIdx = i;
      break;
    }
  }

  if (endIdx === -1) {
    errors.push(`Missing frontmatter closing delimiter in ${file}`);
    return errors;
  }

  const yamlStr = lines.slice(1, endIdx).join("\n").trim();
  if (!yamlStr) {
    errors.push(`Empty frontmatter in ${file}`);
    return errors;
  }

  let frontmatter: any;
  try {
    frontmatter = yaml.parse(yamlStr);
  } catch (err: any) {
    errors.push(`Invalid YAML in ${file}: ${err.message}`);
    return errors;
  }

  if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
    errors.push(`Frontmatter must be a plain object in ${file}`);
    return errors;
  }

  // description
  if (typeof frontmatter.description !== "string" || frontmatter.description.trim() === "") {
    errors.push(`Invalid or missing 'description' in ${file}`);
  }

  // mode
  if (frontmatter.mode !== undefined) {
    if (!["primary", "subagent", "all"].includes(frontmatter.mode)) {
      errors.push(`Invalid 'mode' in ${file}: ${frontmatter.mode}`);
    }
  }

  // tools (legacy)
  if (frontmatter.tools !== undefined) {
    if (frontmatter.tools === null || Array.isArray(frontmatter.tools) || typeof frontmatter.tools !== "object") {
      errors.push(`'tools' must be a plain object in ${file}`);
    } else {
      for (const [key, val] of Object.entries(frontmatter.tools)) {
        if (typeof val !== "boolean") {
          errors.push(`'tools' values must be booleans in ${file} at ${key}`);
        }
      }
    }
  }

  // permission
  if (frontmatter.permission !== undefined) {
    if (frontmatter.permission === null || Array.isArray(frontmatter.permission) || typeof frontmatter.permission !== "object") {
      errors.push(`'permission' must be a plain object in ${file}`);
    } else {
      const validatePermissions = (perms: any, depth = 0, prefix = "") => {
        for (const [key, val] of Object.entries(perms)) {
          if (Array.isArray(val)) {
             errors.push(`Arrays are not allowed in permission map in ${file} at ${prefix}${key}`);
          } else if (typeof val === "object" && val !== null) {
            if (depth > 0) {
              errors.push(`Deeply nested permission maps are not allowed in ${file} at ${prefix}${key}. Permission maps should only be 1 level deep (pattern -> action).`);
            } else {
              validatePermissions(val, depth + 1, `${prefix}${key}.`);
            }
          } else if (typeof val === "string") {
            if (!["allow", "ask", "deny"].includes(val)) {
              errors.push(`Invalid permission action '${val}' in ${file} at ${prefix}${key}`);
            }
          } else {
            errors.push(`Invalid permission structure (expected object or action string) in ${file} at ${prefix}${key}`);
          }
        }
      };
      validatePermissions(frontmatter.permission);
    }
  }

  return errors;
}

export function validateAllAgents(agentsDir: string): string[] {
  const errors: string[] = [];

  if (!existsSync(agentsDir)) {
    errors.push(`Directory not found: ${agentsDir}`);
    return errors;
  }

  const allFiles = readdirSync(agentsDir);
  const markdownFiles = allFiles.filter(f => f.endsWith(".md"));

  if (allFiles.length > 0 && markdownFiles.length === 0) {
    errors.push(`Directory contains only non-Markdown files: ${agentsDir}`);
    return errors;
  }

  if (markdownFiles.length === 0) {
    errors.push(`Empty directory: ${agentsDir}`);
    return errors;
  }

  const foundAgents = new Set<string>();

  for (const file of markdownFiles) {
    const agentName = parse(file).name;
    if (!EXPECTED_AGENTS.has(agentName)) {
      errors.push(`Unexpected agent file: ${file}`);
      continue;
    }
    foundAgents.add(agentName);

    const filePath = join(agentsDir, file);
    const agentErrors = validateAgent(filePath, agentName);
    errors.push(...agentErrors);
  }

  for (const expected of EXPECTED_AGENTS) {
    if (!foundAgents.has(expected)) {
      errors.push(`Missing expected agent: ${expected}.md`);
    }
  }

  return errors;
}

if (import.meta.main) {
  const dir = process.env.AGENTS_DIR || "assets/opencode/agents";
  const errs = validateAllAgents(dir);

  if (errs.length > 0) {
    console.error(`Validation failed with ${errs.length} error(s):`);
    for (const e of errs) {
      console.error(`- ${e}`);
    }
    process.exit(1);
  } else {
    console.log(`Successfully validated agents in ${dir}`);
    process.exit(0);
  }
}
