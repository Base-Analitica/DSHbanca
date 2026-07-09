import { existsSync, mkdirSync, cpSync, readdirSync, writeFileSync } from "node:fs"
import { join, dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const AGENTS = {
  "banca-auditor.md": `---
name: banca-auditor
role: auditor
description: Read-only auditor — evaluates manuscript on citation coverage, ABNT, logic, style.
readOnly: true
tools:
  - banca_context
  - banca_auditar
  - banca_status
---
`,
  "banca-corretor.md": `---
name: banca-corretor
role: editor
description: Applies planned corrections with snapshot + compile validation.
readOnly: false
tools:
  - banca_context
  - banca_corrigir
  - banca_snapshot
  - banca_compile
  - banca_restore
---
`,
  "banca-fontes.md": `---
name: banca-fontes
role: auditor
description: Validates references via MCP/REST provider chain.
readOnly: true
tools:
  - banca_refs
  - banca_context
---
`,
  "banca-integrador.md": `---
name: banca-integrador
role: auditor
description: Consolidates 4-axis scores, applies traps, calculates final grade.
readOnly: true
tools:
  - banca_status
---
`,
  "banca-loop.md": `---
name: banca-loop
role: orchestrator
description: Runs correction loops with circuit breaker.
readOnly: false
tools:
  - banca_loop
  - banca_status
  - banca_context
---
`,
}

const COMMANDS = {
  "banca.md": `---
name: banca
description: Academic board commands
---
# /banca:init — Initialize .banca/ structure
# /banca:status — Show project state
# /banca:auditar — Run citation audit
# /banca:corrigir — Apply corrections
# /banca:refs — Validate references
# /banca:ia — AI risk scan
# /banca:plagio — Parse CopySpider
# /banca:loop — Run correction loop
# /banca:snapshot — Create snapshot
# /banca:restore — Restore from snapshot
# /banca:compile — Compile LaTeX
# /banca:checklist — Verify delivery checklist
# /banca:validate — Validate project.json
`,
}

const SKILLS: Record<string, Record<string, string>> = {
  "banca-avaliacao": {
    "SKILL.md": `# Banca Avaliação\n\nAvalia monografia nos eixos ABNT, citações, conteúdo e estilo.\n\n## Ativação\n@banca-auditor`,
  },
  "banca-correcao": {
    "SKILL.md": `# Banca Correção\n\nAplica correções com snapshot + contrato + validação.\n\n## Ativação\n@banca-corretor`,
  },
  "banca-referencias": {
    "SKILL.md": `# Banca Referências\n\nValida refs via MCP → REST → cache.\n\n## Ativação\n@banca-fontes`,
  },
  "banca-detector-ia": {
    "SKILL.md": `# Banca Detector IA\n\nTriagem de risco IA.\n\n## Ativação\n/banca:ia`,
  },
  "banca-plagio": {
    "SKILL.md": `# Banca Plágio\n\nParsing CopySpider + reescrita.\n\n## Ativação\n/banca:plagio`,
  },
  "banca-planejador": {
    "SKILL.md": `# Banca Planejador\n\nPlano de correção para iteração.\n\n## Ativação\n@banca-planejador`,
  },
  "banca-revisor": {
    "SKILL.md": `# Banca Revisor\n\nRevisa diff bloqueia regressão.\n\n## Ativação\n@banca-revisor`,
  },
  "banca-grille": {
    "SKILL.md": `# Banca Grille\n\nEntrevista antes de correções complexas.\n\n## Ativação\n@banca-grille`,
  },
}

const TEMPLATES: Record<string, string> = {
  "scorecard.md": `# Scorecard\n\n| Dimensão | Nota |\n|----------|------|\n| ABNT/Estrutura | 0.0 |\n| Citações/Fontes | 0.0 |\n| Conteúdo/Lógica | 0.0 |\n| Estilo Acadêmico | 0.0 |\n| **Final** | **0.0** |\n`,
  "iterations.md": `# Iterações\n\n| Data | Nota | Ação | Status |\n|------|------|------|--------|\n`,
  "checklist.md": `# Checklist\n\n- [ ] Formatação ABNT\n- [ ] Ficha catalográfica\n- [ ] Resumo/Abstract\n- [ ] Sumário\n- [ ] Lista de figuras\n- [ ] Lista de tabelas\n- [ ] Referências\n`,
  "knowledge.md": `# Base de Conhecimento\n\n`,
}

function getFilesRecursively(dir: string): string[] {
  const results: string[] = []
  if (!existsSync(dir)) return results
  const list = readdirSync(dir, { withFileTypes: true })
  for (const file of list) {
    const res = join(dir, file.name)
    if (file.isDirectory()) {
      results.push(...getFilesRecursively(res))
    } else {
      results.push(res)
    }
  }
  return results
}

function copyDirectory(src: string, dest: string, force: boolean, installed: string[]) {
  if (!existsSync(src)) return
  const files = getFilesRecursively(src)
  for (const file of files) {
    const rel = relative(src, file)
    const destPath = join(dest, rel)
    const destDir = dirname(destPath)
    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true })
    if (!existsSync(destPath) || force) {
      cpSync(file, destPath)
      installed.push(destPath)
    }
  }
}

export function installAssets(projectRoot: string, force: boolean): string[] {
  const installed: string[] = []

  function write(path: string, content: string) {
    const dir = dirname(path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    if (!existsSync(path) || force) {
      writeFileSync(path, content, "utf-8")
      installed.push(path)
    }
  }

  const pluginAssetsDir = join(__dirname, "..", "..", "assets")

  if (existsSync(pluginAssetsDir)) {
    // Install versioned agents
    copyDirectory(join(pluginAssetsDir, "opencode", "agents"), join(projectRoot, ".opencode", "agents"), force, installed)
    
    // Install versioned commands
    copyDirectory(join(pluginAssetsDir, "opencode", "commands"), join(projectRoot, ".opencode", "commands"), force, installed)
    
    // Install versioned skills
    copyDirectory(join(pluginAssetsDir, "opencode", "skills"), join(projectRoot, ".opencode", "skills"), force, installed)
    
    // Install versioned templates
    copyDirectory(join(pluginAssetsDir, "templates"), join(projectRoot, ".banca"), force, installed)
  } else {
    // Fallback agents
    for (const [name, content] of Object.entries(AGENTS)) {
      write(join(projectRoot, ".opencode", "agents", name), content)
    }

    // Fallback commands
    for (const [name, content] of Object.entries(COMMANDS)) {
      write(join(projectRoot, ".opencode", "commands", name), content)
    }

    // Fallback skills
    for (const [skillName, files] of Object.entries(SKILLS)) {
      for (const [fileName, content] of Object.entries(files)) {
        write(join(projectRoot, ".opencode", "skills", skillName, fileName), content)
      }
    }
  }

  // Ensure default templates exist (write them if not already copied from versioned folder)
  for (const [name, content] of Object.entries(TEMPLATES)) {
    const destPath = join(projectRoot, ".banca", name)
    // Check if it was already installed via versioned copy
    if (!installed.includes(destPath)) {
      write(destPath, content)
    }
  }

  return installed
}
