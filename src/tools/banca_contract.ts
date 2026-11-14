import { lstatSync } from "node:fs"
import { isAbsolute, relative } from "node:path"
import { z } from "zod"
import { defineBancaTool } from "../lib/tool"
import { loadConfig } from "../lib/config"
import { resolveManuscriptPaths, toPosixPath, tryGlobToRegex } from "../lib/paths"
import { loadState } from "../lib/state"
import { saveReport } from "../lib/reports"
import { realWorkspaceRoot, resolveRealInsideRoot } from "../lib/safe_paths"
import {
  destinationIdentityConflict,
  inspectDestinationIdentity,
  lexicalProjectPath,
  logicalProjectRel,
} from "../lib/snapshot"

type ContractConfig = ReturnType<typeof loadConfig>

type InvalidReason =
  | "empty-path"
  | "invalid-logical-path"
  | "canonical-confinement"
  | "not-found"
  | "not-regular-file"
  | "inaccessible"
  | "restricted-namespace"

const INVALID_REASON_LABELS: Record<InvalidReason, string> = {
  "empty-path": "caminho vazio",
  "invalid-logical-path": "caminho fora do projeto ou traversal",
  "canonical-confinement": "destino escapa do workspace ou symlink externo/quebrado",
  "not-found": "arquivo inexistente",
  "not-regular-file": "destino não é arquivo regular",
  "inaccessible": "destino inacessível",
  "restricted-namespace": "destino resolve para namespace restrito do corretor",
}

/**
 * Classificação de um alvo de correção. A ferramenta é somente leitura: aqui
 * apenas validamos o caminho lógico, resolvemos o destino canônico confinado e
 * avaliamos proteção/imutabilidade/allowlist sobre essa identidade canônica,
 * exatamente como o preflight de `banca_corrigir`. Nenhum conteúdo de manuscrito
 * é lido e nenhuma mutação é executada.
 */
type TargetState = {
  /** Cabeçalho de exibição: caminho lógico seguro ou marcador de inválido. */
  display: string
  /** Caminho lógico relativo preservado, quando validável. */
  logical: string | null
  /** Índices 1-based das correções que apontam para este alvo. */
  correctionIndices: number[]
  /** Destino canônico relativo ao workspace, quando resolvido. */
  canonicalRel: string | null
  /** Motivo de invalidação; `null` quando o alvo é válido. */
  invalidReason: InvalidReason | null
  /** Padrões de `protectedPaths` que casaram no caminho canônico. */
  protectedBy: string[]
  /** Padrões de `immutableFacts` que casaram no caminho canônico. */
  immutableBy: string[]
  /** Padrões de `allowedPaths` que casaram no caminho canônico. */
  allowedBy: string[]
  /** `stat.nlink` do destino regular validado (`null` para alvos inválidos). */
  hardlinkCount: number | null
}

/**
 * Escapa, code point a code point, um valor não confiável para exibição em um
 * inline code do Markdown. A saída nunca contém crase, quebra de linha ou
 * caractere de controle: nomes, padrões e metadados não podem criar linhas
 * estruturais nem campos falsos. O mapeamento é injetivo o suficiente para
 * exibir valores distintos de forma distinguível (barra invertida é duplicada,
 * logo uma sequência de escape literal difere do caractere real equivalente).
 *
 * A identidade usada em resolução/classificação/comparação continua sendo o
 * valor original; esta função é aplicada apenas na fronteira de renderização.
 */
function escapeUntrustedForDisplay(value: string): string {
  let escaped = ""
  for (const char of value) {
    const codePoint = char.codePointAt(0) as number
    if (char === "\\") escaped += "\\\\"
    else if (char === "`") escaped += "\\u0060"
    else if (char === "<") escaped += "\\u003c"
    else if (char === ">") escaped += "\\u003e"
    else if (char === "&") escaped += "\\u0026"
    else if (char === "\n") escaped += "\\n"
    else if (char === "\r") escaped += "\\r"
    else if (char === "\t") escaped += "\\t"
    else if (
      codePoint <= 0x1f ||
      codePoint === 0x7f ||
      (codePoint >= 0x80 && codePoint <= 0x9f) ||
      (codePoint >= 0x200b && codePoint <= 0x200f) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029 ||
      codePoint === 0x2060 ||
      codePoint === 0xfeff
    ) {
      escaped += `\\u${codePoint.toString(16).padStart(4, "0")}`
    } else {
      escaped += char
    }
  }
  return escaped
}

function renderUntrusted(value: string): string {
  return `\`${escapeUntrustedForDisplay(value)}\``
}

/**
 * `loadState` lê JSON sem validação completa de tipo. Só um número finito é
 * apresentado como score existente; ausência de score é `—` e qualquer outro
 * valor é declarado inválido, sem inventar nota.
 */
function renderScoreBefore(score: unknown): string {
  if (typeof score === "number" && Number.isFinite(score)) return String(score)
  if (score === null || score === undefined) return "—"
  return "não disponível (valor inválido no state)"
}

function patternMatches(pattern: string, canonicalRel: string): boolean {
  const re = tryGlobToRegex(pattern)
  return re !== null && re.test(canonicalRel)
}

function mapInspectionReason(reason: string): InvalidReason {
  if (reason.includes("protected namespace")) return "restricted-namespace"
  if (reason.includes("not a regular file")) return "not-regular-file"
  if (reason.includes("not accessible")) return "inaccessible"
  if (reason.includes("escapes")) return "canonical-confinement"
  return "restricted-namespace"
}

function classifyCorrection(
  root: string,
  config: ContractConfig,
  rawFile: string,
  correctionIndex: number,
): TargetState {
  const state: TargetState = {
    display: `correção #${correctionIndex} (caminho inválido)`,
    logical: null,
    correctionIndices: [correctionIndex],
    canonicalRel: null,
    invalidReason: null,
    protectedBy: [],
    immutableBy: [],
    allowedBy: [],
    hardlinkCount: null,
  }

  if (typeof rawFile !== "string" || rawFile.trim() === "") {
    state.invalidReason = "empty-path"
    return state
  }

  // Identidade lógica pedida, relativa e segura (preserva a proveniência).
  let logical: string
  try {
    logical = logicalProjectRel(root, lexicalProjectPath(root, rawFile))
  } catch {
    state.invalidReason = "invalid-logical-path"
    return state
  }
  state.logical = logical
  state.display = logical

  // Destino canônico confinado (rejeita symlink externo/quebrado e escapes).
  let canonical: string
  try {
    canonical = resolveRealInsideRoot(root, rawFile)
  } catch {
    state.invalidReason = "canonical-confinement"
    return state
  }
  const canonicalRel = toPosixPath(relative(realWorkspaceRoot(root), canonical))
  if (
    canonicalRel === "" ||
    canonicalRel === ".." ||
    canonicalRel.startsWith("../") ||
    isAbsolute(canonicalRel)
  ) {
    state.invalidReason = "canonical-confinement"
    return state
  }
  state.canonicalRel = canonicalRel

  // Preflight de identidade compartilhado com o corretor (read-only): recusa
  // namespaces protegidos, destinos inacessíveis e não-arquivos regulares.
  const inspection = inspectDestinationIdentity(root, logical)
  if (!inspection.ok) {
    state.invalidReason = mapInspectionReason(inspection.reason)
    return state
  }

  let stat
  try {
    stat = lstatSync(canonical)
  } catch (err) {
    state.invalidReason =
      (err as NodeJS.ErrnoException).code === "ENOENT" ? "not-found" : "inaccessible"
    return state
  }
  if (!stat.isFile()) {
    state.invalidReason = "not-regular-file"
    return state
  }
  state.hardlinkCount = stat.nlink

  // Mesmos globs e mesma identidade canônica usados por banca_corrigir.
  state.protectedBy = config.protectedPaths.filter((pattern) =>
    patternMatches(pattern, canonicalRel),
  )
  state.immutableBy = config.immutableFacts.filter((pattern) =>
    patternMatches(pattern, canonicalRel),
  )
  state.allowedBy = config.allowedPaths.filter((pattern) =>
    patternMatches(pattern, canonicalRel),
  )
  return state
}

function describeIdentityConflict(
  raw: string | null,
  duplicates: number,
  aliases: number,
): string {
  if (raw !== null) {
    if (raw.startsWith("destinations collide:")) {
      return "sim — múltiplos alvos resolvem para o mesmo arquivo físico (banca_corrigir recusaria o lote)"
    }
    return "sim — preflight de identidade do corretor rejeitaria o lote"
  }
  if (duplicates > 0) {
    return "sim — correções repetem o mesmo alvo (banca_corrigir recusaria o lote)"
  }
  if (aliases > 0) {
    return "sim — múltiplos alvos resolvem para o mesmo arquivo físico (banca_corrigir recusaria o lote)"
  }
  return "none (nenhum conflito detectado)"
}

function stateValue(patterns: string[]): string {
  if (patterns.length === 0) return "não"
  return `sim — ${patterns.map((pattern) => renderUntrusted(pattern)).join(", ")}`
}

function targetBlocks(state: TargetState, valid: boolean): string {
  if (!valid) return "destino inválido"
  const blocks: string[] = []
  if (state.protectedBy.length > 0) blocks.push("protectedPaths")
  if (state.immutableBy.length > 0) blocks.push("immutableFacts")
  if (state.allowedBy.length === 0) blocks.push("allowedPaths")
  return blocks.length > 0 ? blocks.join(", ") : "nenhum"
}

function buildReport(
  root: string,
  config: ContractConfig,
  corrections: Array<{ file: string }>,
  scoreBefore: unknown,
): string {
  // Mantém a validação de descoberta de capítulos usada historicamente pela
  // ferramenta; os alvos do contrato não dependem dela.
  void resolveManuscriptPaths(root, config)

  const targets: TargetState[] = []
  const byLogical = new Map<string, TargetState>()
  for (let index = 0; index < corrections.length; index++) {
    const state = classifyCorrection(root, config, corrections[index].file, index + 1)
    if (state.logical !== null) {
      const existing = byLogical.get(state.logical)
      if (existing !== undefined) {
        existing.correctionIndices.push(index + 1)
        continue
      }
      byLogical.set(state.logical, state)
    }
    targets.push(state)
  }

  const correctionsReceived = corrections.length
  const uniqueTargets = targets.length
  const duplicates = correctionsReceived - uniqueTargets
  const validTargets = targets.filter((state) => state.invalidReason === null)
  const invalidTargets = uniqueTargets - validTargets.length
  const canonicalTargets = new Set(validTargets.map((state) => state.canonicalRel)).size
  const aliases = validTargets.length - canonicalTargets
  const protectedTargets = validTargets.filter((state) => state.protectedBy.length > 0).length
  const immutableTargets = validTargets.filter((state) => state.immutableBy.length > 0).length
  const outsideAllowlist = validTargets.filter((state) => state.allowedBy.length === 0).length
  const hardlinkRestricted = validTargets.filter(
    (state) => state.hardlinkCount !== null && state.hardlinkCount > 1,
  ).length
  const immutableBlocked = immutableTargets > 0

  const validLogicals = validTargets
    .map((state) => state.logical)
    .filter((logical): logical is string => logical !== null)
  let identityConflictRaw: string | null = null
  if (validLogicals.length > 0) {
    try {
      identityConflictRaw = destinationIdentityConflict(root, validLogicals)
    } catch {
      identityConflictRaw = "identity preflight rejected the destination plan"
    }
  }
  const identityConflict = describeIdentityConflict(identityConflictRaw, duplicates, aliases)

  // Proveniência de aliases: caminhos lógicos distintos → mesmo destino canônico.
  const logicalsByCanonical = new Map<string, string[]>()
  for (const state of validTargets) {
    if (state.canonicalRel === null || state.logical === null) continue
    const logicals = logicalsByCanonical.get(state.canonicalRel) ?? []
    logicals.push(state.logical)
    logicalsByCanonical.set(state.canonicalRel, logicals)
  }
  const aliasLines: string[] = []
  for (const [canonicalRel, logicals] of logicalsByCanonical) {
    if (logicals.length <= 1) continue
    aliasLines.push(
      `- ${logicals.map((logical) => renderUntrusted(logical)).join(", ")} → ${renderUntrusted(canonicalRel)} (${logicals.length} alvos, 1 destino canônico)`,
    )
  }
  for (const state of targets) {
    if (state.correctionIndices.length > 1 && state.logical !== null) {
      aliasLines.push(
        `- ${renderUntrusted(state.logical)} recebido em ${state.correctionIndices.length} correção(ões) (mesmo alvo repetido)`,
      )
    }
  }
  for (const state of validTargets) {
    if (state.logical === null) continue
    const hardlinkCount = state.hardlinkCount
    if (hardlinkCount !== null && hardlinkCount > 1) {
      aliasLines.push(
        `- ${renderUntrusted(state.logical)} possui nlink=${hardlinkCount} (outros nomes de hardlink não são conhecidos nem varridos; banca_corrigir recusaria o alvo)`,
      )
    }
  }
  if (aliasLines.length === 0) {
    aliasLines.push("- nenhum alias ou repetição de alvo.")
  }

  const lines: string[] = [
    "# Correction Contract",
    "",
    `**Date:** ${new Date().toISOString()}`,
    "**Avaliação, não autorização:** este relatório descreve restrições de caminho dos alvos; não autoriza edição nem substitui o preflight de `banca_corrigir`.",
    `**Corrections:** ${correctionsReceived}`,
    `**Files:** ${uniqueTargets}`,
    `**Canonical targets:** ${canonicalTargets}`,
    `**Duplicate corrections:** ${duplicates}`,
    `**Aliases:** ${aliases}`,
    `**Invalid targets:** ${invalidTargets}`,
    `**Protected targets:** ${protectedTargets}`,
    `**Immutable targets:** ${immutableTargets}`,
    `**Outside allowedPaths:** ${outsideAllowlist}`,
    `**Hardlink-restricted targets:** ${hardlinkRestricted}`,
    `**Immutable blocked:** ${immutableBlocked}`,
    `**Identity conflict:** ${identityConflict}`,
    `**Score before:** ${renderScoreBefore(scoreBefore)}`,
    `**External deps:** ${config.externalDependencies.length > 0 ? config.externalDependencies.map((dependency) => renderUntrusted(String(dependency))).join(", ") : "—"}`,
    "",
    "## Alvos por correção",
  ]

  for (const state of targets) {
    const valid = state.invalidReason === null
    const heading =
      state.logical !== null
        ? `### ${renderUntrusted(state.logical)}`
        : `### ${state.display}`
    const hardlinkRestriction =
      !valid || state.hardlinkCount === null
        ? "não avaliável"
        : state.hardlinkCount > 1
          ? `sim — nlink=${state.hardlinkCount} (banca_corrigir recusaria o alvo)`
          : "não"
    lines.push(
      "",
      heading,
      `- Corrections: ${state.correctionIndices.length}`,
      `- Correction indices: ${state.correctionIndices.join(", ")}`,
      `- Logical path: ${state.logical !== null ? renderUntrusted(state.logical) : "não disponível (caminho inválido)"}`,
      `- Canonical path: ${state.canonicalRel !== null ? renderUntrusted(state.canonicalRel) : "não resolvido"}`,
      `- Valid target: ${valid ? "sim" : `não — ${INVALID_REASON_LABELS[state.invalidReason as InvalidReason]}`}`,
      `- Protected (protectedPaths): ${valid ? stateValue(state.protectedBy) : "não avaliável"}`,
      `- Immutable (immutableFacts): ${valid ? stateValue(state.immutableBy) : "não avaliável"}`,
      `- Allowed (allowedPaths): ${valid ? stateValue(state.allowedBy) : "não avaliável"}`,
      `- Path blocks: ${targetBlocks(state, valid)}`,
      `- Identity restriction (hardlinks): ${hardlinkRestriction}`,
    )
  }

  lines.push(
    "",
    "## Aliases e destinos repetidos",
    ...aliasLines,
    "",
    "## Bloqueios agregados",
    `- Proteção (protectedPaths): ${protectedTargets} alvo(s)`,
    `- Imutabilidade (immutableFacts): ${immutableTargets} alvo(s)`,
    `- Fora da allowlist (allowedPaths): ${outsideAllowlist} alvo(s)`,
    `- Restrição de hardlink (nlink>1): ${hardlinkRestricted} alvo(s)`,
    `- Destino inválido: ${invalidTargets} alvo(s)`,
    `- Conflito de identidade de destino: ${identityConflictRaw !== null || duplicates > 0 || aliases > 0 ? "sim" : "não"}`,
    "",
    "## Limitações",
    "- Este relatório avalia alvos e restrições de caminho; **não autoriza edição**.",
    "- Ausência de bloqueio de caminho não comprova aprovação humana, permissão do host, validade das substituições, contagem de ocorrências, existência de snapshot, preflight completo de `banca_corrigir` ou execução/sucesso de correção.",
    "- Proteção (`protectedPaths`), allowlist (`allowedPaths`) e imutabilidade (`immutableFacts`) usam a identidade canônica e os mesmos globs de `banca_corrigir`; proteção e imutabilidade são estados distintos.",
    "- Alvos repetidos, aliases e conflito de identidade física são contabilizados sem consolidação silenciosa; um conflito reportado indica que `banca_corrigir` recusaria o lote.",
    "- Alvos regulares com múltiplos hardlinks (nlink>1) são reportados como restrição de identidade física; `banca_corrigir` recusa esses destinos antes de qualquer snapshot ou escrita. Outros nomes de hardlink podem existir fora da seleção e não são varridos nem inventados.",
    "- Nenhuma correção foi executada, nenhum snapshot foi criado e manuscrito/state não foram alterados.",
    "- `Score before` vem do state existente; nenhum score novo, impacto na nota ou diff é calculado.",
  )

  return lines.join("\n")
}

export const bancaContract = defineBancaTool({
  description: "Generate correction contract: diff summary, immutable facts check, score impact.",
  args: {
    projectRoot: z.string().optional().describe("Project root (default: cwd)"),
    corrections: z.array(z.object({
      file: z.string(),
      oldText: z.string(),
      newText: z.string(),
    })).describe("Applied corrections to audit"),
    save: z.boolean().optional().describe("Save contract to .banca/reports/"),
  },
  execute: async (args, ctx) => {
    const root = args.projectRoot || ctx.directory
    const config = loadConfig(root)
    const corrections = args.corrections || []
    const state = loadState(root)

    const text = buildReport(root, config, corrections, state.currentScore)

    if (args.save) saveReport(root, `contract-${Date.now()}.md`, text)

    return text
  },
})
