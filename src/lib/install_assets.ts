import { existsSync, cpSync, lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join, dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { prepareRealPathForWrite, resolveRealInsideRoot } from "./safe_paths"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const AGENTS = {
  "banca-auditor.md": `---
description: Executa auditoria exaustiva do manuscrito por lotes canônicos e prepara a síntese global após cobertura completa.
mode: subagent
permission:
  "*": deny
  skill:
    "*": deny
    banca-avaliacao: allow
  read:
    "*": deny
    ".banca/context/context-*.md": allow
  banca_context: allow
  banca_auditar: allow
  banca_sintese: allow
---

## Auditor de Monografia

Função: orquestrar a auditoria acadêmica exaustiva do manuscrito canônico por lotes, usando apenas as tools autorizadas, e produzir a síntese acadêmica global após cobertura completa. Não atribui pontuação numérica global, aprovação ou reprovação.

### Ferramentas

- skill \`banca-avaliacao\` — protocolo obrigatório deste fluxo
- \`banca_context\` — criar ou retomar o checkpoint e obter o próximo lote (retorna \`context → <caminho>\`)
- \`read\` — somente no caminho exato do context pack retornado (\`.banca/context/context-*.md\`)
- \`banca_auditar\` — validar e persistir findings de um único lote
- \`banca_sintese\` — obter entrada de síntese global somente após cobertura completa

### Protocolo

Siga a skill \`banca-avaliacao\` sem desviar:

1. Chamar \`banca_context\` sem \`completedBatchId\` para criar ou retomar o checkpoint.
2. Após cada chamada bem-sucedida de \`banca_context\`, usar a ferramenta nativa \`read\` no caminho exato retornado em \`context → <caminho>\`. Não ler o manuscrito diretamente nem procurar outros arquivos.
3. Somente depois do \`read\`, extrair fingerprint, batchId, chunks e proveniência do context pack.
4. Analisar todos os chunks do lote atual.
5. Chamar \`banca_auditar\` com fingerprint e batchId exatos (array vazio de findings é válido).
6. Avançar somente após recibo bem-sucedido de \`banca_auditar\`.
7. Chamar novamente \`banca_context\` com \`completedBatchId\` igual ao lote concluído.
8. Repetir a partir do passo 2 (incluindo \`read\` do novo caminho) até não existir próximo lote.
9. Chamar \`banca_sintese\` somente quando o contexto comprovar checkpoint completo e ausência de próximo lote.
10. Somente após \`banca_sintese\` retornar com sucesso uma entrada de cobertura completa, produzir a **síntese acadêmica global** relacionando findings de lotes diferentes. O mero repasse estruturado da entrada de \`banca_sintese\` **não** é comportamento final suficiente.

Ordem lógica:

\`\`\`text
banca_context
→ read do caminho retornado
→ análise de um lote
→ banca_auditar
→ banca_context com completedBatchId
→ read do caminho retornado
→ repetir
→ banca_sintese somente após cobertura completa
→ síntese acadêmica global após retorno bem-sucedido de banca_sintese
\`\`\`

### Síntese acadêmica global

Após o retorno bem-sucedido de \`banca_sintese\`, relacionar os findings validados e produzir estas seções:

1. **Síntese global do manuscrito**
2. **Contradições ou tensões entre seções**
3. **Coerência entre objetivos, método, resultados e conclusão**
4. **Lacunas globais de argumentação ou evidência**
5. **Redundâncias e inconsistências recorrentes**
6. **Prioridades de revisão**

Quando não houver evidência suficiente para uma categoria, declare que nenhum problema global comprovável foi identificado nela.

Toda conclusão global deve citar os findings de suporte com \`findingId\`, arquivo, linhas, seção e claim ou evidence. Observações que dependem de múltiplos findings devem listar todos. Não invente finding, arquivo, linha, seção, fingerprint ou relação causal.

Findings locais são criados e persistidos somente por \`banca_auditar\`. A síntese global relaciona findings já validados e **não** cria silenciosamente novos findings persistidos. Irregularidade descoberta só na fase global deve ser **observação global que requer revisão humana**, sem fingir que foi validada e persistida.

### Interrupção

Se contexto, \`read\`, auditoria ou síntese retornar erro, plano bloqueado, fingerprint incompatível, cobertura incompleta, contrato inválido ou dados insuficientes: interromper o fluxo sem gerar pontuação, score, aprovação, reprovação ou parecer integral do manuscrito. Não transforme resultados parciais em parecer completo.

### Limites

- Não invente arquivo, linha, fingerprint ou batchId.
- Não persista findings fora de \`banca_auditar\`.
- Não altere o manuscrito.
- Não calcule pontuação global nem aplique pesos, tetos ou travas.
- Não use linguagem de nota acadêmica, aprovação institucional, reprovação ou previsão de banca.
- Não delegue ao integrador como parte deste fluxo.
- Não use \`read\` fora do path exato do context pack retornado por \`banca_context\`.
`,
  "banca-corretor.md": `---
description: Aplica correções no manuscrito seguindo plano e contrato.
mode: subagent
permission:
  "*": deny
  skill:
    "*": deny
    banca-correcao: allow
  banca_context: allow
  banca_corrigir: allow
  banca_snapshot: allow
  banca_compile: allow
  banca_restore: allow
---

## Corretor

Aplica correções planejadas no manuscrito.

### Regras

1. Sempre criar snapshot antes de editar (\`banca_snapshot\`)
2. Sempre compilar após editar (\`banca_compile\`)
3. Nunca alterar dados primários sem confirmação
4. Preservar caminhos protegidos
5. Gerar contrato JSON das alterações

### Fluxo

1. \`banca_context\` → entender estado atual
2. \`banca_snapshot\` → backup
3. Aplicar correções com \`banca_corrigir\`
4. \`banca_compile\` → validar compilação
5. Se falhar: restaurar do snapshot com \`banca_restore\`\n`,
  "banca-fontes.md": `---
description: Valida referências e citações usando MCPs acadêmicos.
mode: subagent
permission:
  "*": deny
  skill:
    "*": deny
    banca-referencias: allow
  banca_refs: allow
  banca_context: allow
---

## Auditor de Fontes

Valida cada entrada do \`.bib\` contra bases acadêmicas.

### Fluxo

1. \`banca_refs\` → extrair referências do \`.bib\`
2. Para cada referência, chamar MCP acadêmico para validar existência e metadados
3. Calcular score de confiança (0-100)
4. Reportar referências não encontradas ou suspeitas

### Comportamento

- Depende de MCPs: crossref-academic, pubmed, openalex, semantic-scholar
- Se MCP estiver ausente, declarar limitação, não falhar\n`,
  "banca-integrador.md": `---
description: Integra pareceres dos 4 avaliadores, aplica travas e calcula nota final.
mode: subagent
permission:
  "*": deny
  skill: deny
  banca_status: allow
---

## Integrador

Consolida as notas dos 4 avaliadores e aplica as travas de nota.

### Comportamento

1. Receber notas: ABNT, Citações, Conteúdo, Estilo
2. Calcular média ponderada
3. Aplicar travas (ficha catalográfica, >30% sem citação, etc.)
4. Aplicar tetos (limites institucionais)
5. Gerar nota final e veredito\n`,
  "banca-loop.md": `---
description: Orquestra etapa assistida e preparatória do loop de correção.
mode: subagent
permission:
  "*": deny
  skill:
    "*": deny
    banca-planejador: allow
  banca_loop: allow
  banca_status: allow
  banca_context: allow
---

## Orquestrador de Loops

Coordena execução de etapa assistida e preparatória do loop de correção.

### Loops Disponíveis

| Loop | Descrição | Goal |
|------|-----------|------|
| \`correcao-continua\` | auditar → corrigir → verificar | Nota ≥ 9.0 |
| \`vigilancia-refs\` | validar referências | Score ≥ 90% |
| \`deteccao-ia\` | triagem de risco IA | Relatório por arquivo |

### Comportamento

- Executa loops FIFO (um por vez)
- Cria snapshot antes de cada iteração
- Aplica circuit breaker em oscilação/estagnação
- Alerta usuário em falhas críticas\n`,
}

const COMMANDS = {
  "banca-init.md": `---
description: Initialize banca
---

Please execute the \`banca_init\` tool to initialize the project structure. Do not run any terminal commands.\n`,
  "banca-auditar.md": `---
description: Executa a auditoria acadêmica exaustiva do manuscrito
agent: banca-auditor
subtask: true
---

Execute a auditoria acadêmica exaustiva do projeto atual.

Siga integralmente a skill \`banca-avaliacao\` e o workflow acadêmico do subagent \`banca-auditor\`. Não duplique nem redefina o protocolo aqui.

Limites obrigatórios:

- Não altere o manuscrito.
- Não execute shell.
- Não calcule score, pontuação global, pesos, tetos ou travas.
- Não produza parecer integral, síntese global completa ou conclusão de cobertura quando checkpoint, findings, cobertura ou síntese estiverem incompletos ou bloqueados.
`,
  "banca.md": `---
name: banca
description: Comandos do sistema de banca acadêmica
---

# Comandos do OpenBanca

## Comandos Registrados

### \`/banca-init\`
Inicializa a estrutura \`.banca/\` no projeto utilizando a ferramenta \`banca_init\` registrada no plugin.

### \`/banca-auditar\`
Executa a auditoria acadêmica exaustiva do manuscrito invocando o subagent \`banca-auditor\` (skill \`banca-avaliacao\`). Não altera o manuscrito e não emite veredito institucional nem pontuação global.

## Funcionalidades Futuras Planejadas

Estes comandos ainda não possuem arquivos de comando registrados no OpenCode, mas suas funcionalidades poderão ser acessadas delegando tarefas para os agentes ou futuramente por comandos diretos:

- \`/banca:status\` — Exibir estado atual do projeto.
- \`/banca:corrigir\` — Aplicar correções com snapshot automático.
- \`/banca:refs\` — Gerar certidão de referências.
- \`/banca:ia\` — Executar triagem de risco de IA.
- \`/banca:plagio\` — Parsear relatório CopySpider.
- \`/banca:loop\` — Executar etapa assistida de preparação do loop.
- \`/banca:checklist\` — Verificar checklist de entrega.
- \`/banca:snapshot\` — Criar snapshot manual.
- \`/banca:compile\` — Compilar manuscrito LaTeX.
`,
}

export const EXPECTED_CANONICAL_SKILLS = [
  "banca-avaliacao",
  "banca-correcao",
  "banca-detector-ia",
  "banca-grille",
  "banca-plagio",
  "banca-planejador",
  "banca-referencias",
  "banca-revisor",
] as const

interface SkillFrontmatterValidation {
  valid: boolean
  error?: string
  name?: string
  description?: string
}

function validateSkillFrontmatter(content: string, expectedName: string): SkillFrontmatterValidation {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return { valid: false, error: "Missing initial '---' delimiter" }
  }
  const match = content.match(/\n---(?:\r?\n|$)/)
  if (!match) {
    return { valid: false, error: "Frontmatter not closed" }
  }
  const startIndex = content.startsWith("---\n") ? 4 : 5
  const endFrontmatter = match.index!
  let frontmatter = content.substring(startIndex, endFrontmatter)
  if (frontmatter.endsWith("\r")) frontmatter = frontmatter.slice(0, -1)

  const lines = frontmatter.split("\n")
  let name: string | undefined
  let description: string | undefined

  for (const line of lines) {
    const nameMatch = /^name:\s*(.*)$/.exec(line.trim())
    if (nameMatch) {
      let val = nameMatch[1].trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      name = val
    }
    const descMatch = /^description:\s*(.*)$/.exec(line.trim())
    if (descMatch) {
      let val = descMatch[1].trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      description = val
    }
  }

  if (!name) return { valid: false, error: "Missing 'name' in frontmatter" }
  if (name !== expectedName) return { valid: false, error: `'name' in frontmatter (${name}) does not match directory name (${expectedName})` }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || name.length < 1 || name.length > 64) {
    return { valid: false, error: `Invalid skill name format: ${name}` }
  }
  if (!description || description.trim() === "") {
    return { valid: false, error: "Missing or empty 'description' in frontmatter" }
  }
  return { valid: true, name, description }
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

function copyDirectory(projectRoot: string, src: string, dest: string, force: boolean, installed: string[]) {
  if (!existsSync(src)) return
  const files = getFilesRecursively(src)
  for (const file of files) {
    const rel = relative(src, file)
    const destPath = prepareRealPathForWrite(projectRoot, join(dest, rel))
    if (!existsSync(destPath) || force) {
      cpSync(file, destPath)
      installed.push(destPath)
    }
  }
}

export function installAssets(
  projectRoot: string,
  force: boolean,
  customAssetsDir?: string,
  customSkillsDir?: string,
): string[] {
  const installed: string[] = []

  // Preflight canonical skills directory
  const defaultCanonicalSkillsDir = join(__dirname, "..", "..", "skills")
  const canonicalSkillsDir = customSkillsDir || defaultCanonicalSkillsDir

  if (!existsSync(canonicalSkillsDir)) {
    throw new Error(`canonical skills directory does not exist: ${canonicalSkillsDir}`)
  }
  const canonicalDirStat = lstatSync(canonicalSkillsDir)
  if (canonicalDirStat.isSymbolicLink() || !canonicalDirStat.isDirectory()) {
    throw new Error(`canonical skills directory must be a regular directory: ${canonicalSkillsDir}`)
  }

  const canonicalSkillContents = new Map<string, Buffer>()

  for (const skillName of EXPECTED_CANONICAL_SKILLS) {
    const skillDir = join(canonicalSkillsDir, skillName)
    if (!existsSync(skillDir)) {
      throw new Error(`canonical skill directory missing: ${skillName}`)
    }
    const skillDirStat = lstatSync(skillDir)
    if (skillDirStat.isSymbolicLink() || !skillDirStat.isDirectory()) {
      throw new Error(`canonical skill directory ${skillName} must be a regular directory`)
    }

    const skillFile = join(skillDir, "SKILL.md")
    if (!existsSync(skillFile)) {
      throw new Error(`canonical skill SKILL.md missing: ${skillName}`)
    }
    const fileStat = lstatSync(skillFile)
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
      throw new Error(`canonical skill ${skillName}/SKILL.md must be a regular file`)
    }

    const contentBuf = readFileSync(skillFile)
    const validation = validateSkillFrontmatter(contentBuf.toString("utf8"), skillName)
    if (!validation.valid) {
      throw new Error(`canonical skill ${skillName}/SKILL.md has invalid frontmatter: ${validation.error}`)
    }
    canonicalSkillContents.set(skillName, contentBuf)
  }

  const pluginAssetsDir = customAssetsDir || join(__dirname, "..", "..", "assets")
  const assetsAvailable = existsSync(pluginAssetsDir)

  if (assetsAvailable) {
    // If assets directory exists, fail-closed before any mutations if incomplete
    const agentsDir = join(pluginAssetsDir, "dsh", "agents")
    if (!existsSync(agentsDir) || !lstatSync(agentsDir).isDirectory()) {
      throw new Error(`custom assets directory is incomplete: missing ${join("dsh", "agents")}`)
    }
    for (const agentName of Object.keys(AGENTS)) {
      const agentFile = join(agentsDir, agentName)
      if (!existsSync(agentFile) || !lstatSync(agentFile).isFile()) {
        throw new Error(`custom assets directory is incomplete: missing ${join("dsh", "agents", agentName)}`)
      }
    }

    const commandsDir = join(pluginAssetsDir, "dsh", "commands")
    if (!existsSync(commandsDir) || !lstatSync(commandsDir).isDirectory()) {
      throw new Error(`custom assets directory is incomplete: missing ${join("dsh", "commands")}`)
    }
    for (const cmdName of Object.keys(COMMANDS)) {
      const cmdFile = join(commandsDir, cmdName)
      if (!existsSync(cmdFile) || !lstatSync(cmdFile).isFile()) {
        throw new Error(`custom assets directory is incomplete: missing ${join("dsh", "commands", cmdName)}`)
      }
    }
  }

  const versionedAuditor = join(pluginAssetsDir, "dsh", "agents", "banca-auditor.md")
  const expectedAuditor = assetsAvailable && existsSync(versionedAuditor)
    ? readFileSync(versionedAuditor)
    : Buffer.from(AGENTS["banca-auditor.md"], "utf8")
  const existingAuditorAsset = join(projectRoot, ".dsh", "agents", "banca-auditor.md")
  const auditorLoaderCopy = join(projectRoot, "banca-auditor.md")

  // Preflight both instruction destinations before any installer writes. This
  // keeps a user-owned root file collision from leaving a partially installed
  // .dsh/.banca tree behind, even when force is enabled.
  for (const [path, label] of [[existingAuditorAsset, "installed"], [auditorLoaderCopy, "loader"]] as const) {
    try {
      const stat = lstatSync(path)
      if (!stat.isFile()) throw new Error(`${label} banca-auditor instructions must be a regular file`)
      const safePath = resolveRealInsideRoot(projectRoot, path)
      if (!readFileSync(safePath).equals(expectedAuditor)) {
        throw new Error(`${label} banca-auditor instructions differ from the canonical source`)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
  }
  prepareRealPathForWrite(projectRoot, auditorLoaderCopy)

  // Preflight: the asset roots themselves must resolve inside the workspace
  // before anything is written. A symlinked `.dsh`/`.banca` pointing outside
  // blocks the whole installation with no partial external changes.
  resolveRealInsideRoot(projectRoot, join(projectRoot, ".dsh"))
  resolveRealInsideRoot(projectRoot, join(projectRoot, ".banca"))
  resolveRealInsideRoot(projectRoot, join(projectRoot, ".dsh", "skills"))

  for (const p of [join(projectRoot, ".dsh"), join(projectRoot, ".dsh", "skills")]) {
    try {
      const st = lstatSync(p)
      if (st.isSymbolicLink()) {
        throw new Error(`destination ${relative(projectRoot, p)} must not be a symbolic link`)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
  }

  // Preflight destination skills
  for (const skillName of EXPECTED_CANONICAL_SKILLS) {
    const destSkillDir = join(projectRoot, ".dsh", "skills", skillName)
    const destSkillFile = join(destSkillDir, "SKILL.md")

    resolveRealInsideRoot(projectRoot, destSkillDir)
    resolveRealInsideRoot(projectRoot, destSkillFile)

    try {
      const dirStat = lstatSync(destSkillDir)
      if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
        throw new Error(`installed skill directory ${skillName} must be a regular directory`)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }

    try {
      const fileStat = lstatSync(destSkillFile)
      if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
        throw new Error(`installed skill ${skillName}/SKILL.md must be a regular file`)
      }
      const safePath = resolveRealInsideRoot(projectRoot, destSkillFile)
      const existingContent = readFileSync(safePath)
      const canonicalContent = canonicalSkillContents.get(skillName)!
      if (!existingContent.equals(canonicalContent)) {
        throw new Error(`installed skill ${skillName}/SKILL.md differs from the canonical source`)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
  }

  function write(path: string, content: string) {
    const target = prepareRealPathForWrite(projectRoot, path)
    if (!existsSync(target) || force) {
      writeFileSync(target, content, "utf-8")
      installed.push(target)
    }
  }

  if (assetsAvailable) {
    // Install versioned agents (DSH-native)
    copyDirectory(projectRoot, join(pluginAssetsDir, "dsh", "agents"), join(projectRoot, ".dsh", "agents"), force, installed)

    // Install versioned commands
    copyDirectory(projectRoot, join(pluginAssetsDir, "dsh", "commands"), join(projectRoot, ".dsh", "commands"), force, installed)

    // Install versioned templates
    copyDirectory(projectRoot, join(pluginAssetsDir, "templates"), join(projectRoot, ".banca"), force, installed)
  } else {
    // Fallback agents (DSH-native)
    for (const [name, content] of Object.entries(AGENTS)) {
      write(join(projectRoot, ".dsh", "agents", name), content)
    }

    // Fallback commands (DSH-native)
    for (const [name, content] of Object.entries(COMMANDS)) {
      write(join(projectRoot, ".dsh", "commands", name), content)
    }
  }

  // Install the 8 canonical skills (ALWAYS from canonical skills/, never from assets or duplicate string constants)
  for (const skillName of EXPECTED_CANONICAL_SKILLS) {
    const destSkillFile = join(projectRoot, ".dsh", "skills", skillName, "SKILL.md")
    const target = prepareRealPathForWrite(projectRoot, destSkillFile)
    if (!existsSync(target) || force) {
      writeFileSync(target, canonicalSkillContents.get(skillName)!)
      installed.push(target)
    }
  }

  // The native DSH instructions loader resolves basename candidates relative
  // to the Agent workspace. Keep the established .dsh installation, and add
  // one regular workspace-root copy derived from that installed canonical
  // asset. Never replace a user file or follow a workspace alias here.
  const auditorSource = join(projectRoot, ".dsh", "agents", "banca-auditor.md")
  const sourceStat = lstatSync(auditorSource)
  if (!sourceStat.isFile()) {
    throw new Error("canonical banca-auditor instructions must be a regular file")
  }
  const sourceContent = readFileSync(auditorSource)
  if (!sourceContent.equals(expectedAuditor)) {
    throw new Error("installed banca-auditor instructions differ from the canonical source")
  }
  let destinationStat
  try {
    destinationStat = lstatSync(auditorLoaderCopy)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  if (destinationStat) {
    if (!destinationStat.isFile()) {
      throw new Error("banca-auditor loader destination must be a regular file")
    }
    const destination = resolveRealInsideRoot(projectRoot, auditorLoaderCopy)
    if (!readFileSync(destination).equals(sourceContent)) {
      throw new Error("banca-auditor loader destination collides with an existing workspace file")
    }
  } else {
    const target = prepareRealPathForWrite(projectRoot, auditorLoaderCopy)
    writeFileSync(target, sourceContent, { flag: "wx" })
    installed.push(target)
  }

  // Ensure default templates exist (write them if not already copied from versioned folder)
  for (const [name, content] of Object.entries(TEMPLATES)) {
    const destPath = resolveRealInsideRoot(projectRoot, join(projectRoot, ".banca", name))
    // Check if it was already installed via versioned copy
    if (!installed.includes(destPath)) {
      write(destPath, content)
    }
  }

  return installed
}
