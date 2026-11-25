/**
 * Fronteira de empacotamento do piloto semântico cego — issue #182.
 *
 * Prova, sobre o TARBALL REAL produzido por `npm pack` (offline, lifecycle do
 * pack desabilitado, HOME/TMP/cache/prefixo/config npm privados), que:
 * - o protocolo experimental e o material do corpus/gabarito/helpers ficam fora
 *   da seleção de arquivos distribuída;
 * - documentação não experimental, assets, as oito skills canônicas,
 *   entrypoints compilados e o patch Cordis permanecem presentes e íntegros;
 * - um controle negativo que reintroduz o protocolo experimental na seleção é
 *   corretamente detectado.
 *
 * O teste não publica, não instala e não inicia DSH/Agent/Session, modelo,
 * credencial, MCP, rede de inferência ou custo. Ele escreve apenas em scratch
 * próprio criado por este teste e remove esse scratch no `afterAll`.
 *
 * Build: em CI o build roda antes da suíte. Se `dist/` estiver ausente em uma
 * execução focal, o build existente (`bun run build`) é executado uma vez, como
 * já faz o teste H de `tests/skills.test.ts`, para provar o artefato compilado.
 */

import { afterAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const REPO_ROOT = path.resolve(import.meta.dir, "..")
const PROTOCOL_RELATIVE_PATH = "docs/academic-semantic-pilot.md"
const EXPERIMENTAL_FIXTURE_RELATIVE_PATH = "tests/fixtures/academic-semantic-pilot"
const CANONICAL_SKILLS = [
  "banca-avaliacao",
  "banca-correcao",
  "banca-detector-ia",
  "banca-grille",
  "banca-plagio",
  "banca-planejador",
  "banca-referencias",
  "banca-revisor",
]
const REQUIRED_ENTRYPOINTS = [
  "dist/index.js",
  "dist/index.d.ts",
  "dist/dsh.js",
  "dist/dsh.d.ts",
  "dist/lib/tools.js",
]
/**
 * Marcadores que só existem no material experimental (protocolo/gabarito) e que
 * não podem chegar ao conteúdo empacotado. A menção genérica à existência de um
 * piloto continua permitida; estes identificadores antecipam artefatos e
 * respostas experimentais.
 */
const ANSWER_ANTICIPATING_MARKERS = [
  "provisional-ground-truth",
  "synthetic-submissions",
  "provisional_pending_human_ratification",
  "academic-semantic-pilot-corpus-v1",
]
const PACK_SUBPROCESS_TIMEOUT_MS = 120_000
const PACK_TEST_TIMEOUT_MS = 180_000

interface PackArtifact {
  filename: string
  tarballPath: string
  tarballSha256: string
  entries: string[]
  packageRoot: string
}

let scratchRoot: string | undefined
let productArtifact: PackArtifact | undefined

function sha256File(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex")
}

/** Lista apenas arquivos regulares, em caminhos POSIX relativos, ordenados. */
function walkRegularFiles(root: string, relative = ""): string[] {
  const absolute = relative ? path.join(root, relative) : root
  const files: string[] = []
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const entryRelative = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      files.push(...walkRegularFiles(root, entryRelative))
    } else if (entry.isFile()) {
      files.push(entryRelative)
    }
  }
  return files.sort()
}

/**
 * Seleção que retorna violações da fronteira experimental. Um artefato
 * experimentalmente neutro não pode entregar o protocolo, o corpus, o gabarito,
 * os cenários, os helpers do avaliador/materializador nem cópias sob `tests/`.
 */
function findBoundaryViolations(entries: string[]): string[] {
  return entries.filter((entry) => {
    if (entry === PROTOCOL_RELATIVE_PATH) return true
    if (entry.startsWith("tests/") || entry.includes("/tests/")) return true
    if (/semantic[-_]pilot/i.test(entry)) return true
    if (/(^|\/)(answer-key|scenarios)\//i.test(entry)) return true
    if (/provisional-ground-truth|synthetic-submissions/i.test(entry)) return true
    return false
  })
}

function preparePrivateEnvironment(scratch: string): NodeJS.ProcessEnv {
  const home = path.join(scratch, "home")
  const tmp = path.join(scratch, "tmp")
  const cache = path.join(scratch, "npm-cache")
  const prefix = path.join(scratch, "npm-prefix")
  for (const directory of [home, tmp, cache, prefix]) {
    mkdirSync(directory, { recursive: true })
  }
  const userConfig = path.join(home, ".npmrc")
  const globalConfig = path.join(scratch, "npm-globalrc")
  writeFileSync(userConfig, "offline=true\nignore-scripts=true\n")
  writeFileSync(globalConfig, "")
  return {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: home,
    TMPDIR: tmp,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    NO_COLOR: "1",
    npm_config_cache: cache,
    npm_config_userconfig: userConfig,
    npm_config_globalconfig: globalConfig,
    npm_config_prefix: prefix,
    npm_config_offline: "true",
    npm_config_ignore_scripts: "true",
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_update_notifier: "false",
    npm_config_loglevel: "error",
  }
}

function scratchDir(): string {
  if (!scratchRoot) {
    scratchRoot = mkdtempSync(path.join(tmpdir(), "dshbanca-182-"))
  }
  return scratchRoot
}

/** Produz e extrai um tarball real com seleção efetiva do npm. */
function runNpmPack(sourceDir: string, scratch: string, label: string): PackArtifact {
  const env = preparePrivateEnvironment(scratch)
  const packDir = path.join(scratch, `${label}-pack`)
  const extractDir = path.join(scratch, `${label}-extract`)
  mkdirSync(packDir, { recursive: true })
  mkdirSync(extractDir, { recursive: true })

  const pack = spawnSync(
    "npm",
    ["pack", "--ignore-scripts", "--offline", "--pack-destination", packDir, "--json"],
    { cwd: sourceDir, env, encoding: "utf8", timeout: PACK_SUBPROCESS_TIMEOUT_MS },
  )
  expect(pack.status, `npm pack (${label}) falhou: ${pack.stderr ?? ""}`).toBe(0)

  const [info] = JSON.parse(pack.stdout) as Array<{
    filename: string
    files: Array<{ path: string }>
    size: number
    unpackedSize: number
  }>
  expect(info?.filename, `npm pack (${label}) não retornou filename`).toBeTruthy()
  const tarballPath = path.join(packDir, String(info.filename))
  expect(existsSync(tarballPath), `tarball ausente: ${String(info.filename)}`).toBe(true)

  const extract = spawnSync("tar", ["-xzf", tarballPath, "-C", extractDir], {
    env: { PATH: env.PATH, HOME: env.HOME, TMPDIR: env.TMPDIR },
    encoding: "utf8",
    timeout: PACK_SUBPROCESS_TIMEOUT_MS,
  })
  expect(extract.status, `tar falhou (${label}): ${extract.stderr ?? ""}`).toBe(0)

  const packageRoot = path.join(extractDir, "package")
  expect(existsSync(path.join(packageRoot, "package.json")), `tarball (${label}) sem package.json`).toBe(true)
  const entries = walkRegularFiles(packageRoot)
  expect(entries.length, `tarball (${label}) vazio`).toBeGreaterThan(0)

  return {
    filename: String(info.filename),
    tarballPath,
    tarballSha256: sha256File(tarballPath),
    entries,
    packageRoot,
  }
}

function ensureBuildArtifacts(): void {
  const missing = REQUIRED_ENTRYPOINTS.filter((relative) => !existsSync(path.join(REPO_ROOT, relative)))
  if (missing.length === 0) return
  const build = spawnSync("bun", ["run", "build"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: PACK_SUBPROCESS_TIMEOUT_MS,
  })
  expect(build.status, `build falhou (faltavam: ${missing.join(", ")}): ${build.stderr ?? ""}`).toBe(0)
  for (const relative of REQUIRED_ENTRYPOINTS) {
    expect(existsSync(path.join(REPO_ROOT, relative)), `build não produziu ${relative}`).toBe(true)
  }
}

function packedProduct(): PackArtifact {
  if (!productArtifact) {
    ensureBuildArtifacts()
    productArtifact = runNpmPack(REPO_ROOT, scratchDir(), "green")
    console.log(
      `[#182] tarball=${productArtifact.filename} sha256=${productArtifact.tarballSha256} entries=${productArtifact.entries.length}`,
    )
  }
  return productArtifact
}

function collectExportTargets(value: unknown): string[] {
  if (typeof value === "string") return value.startsWith("./") ? [value] : []
  if (Array.isArray(value)) return value.flatMap(collectExportTargets)
  if (value && typeof value === "object") return Object.values(value).flatMap(collectExportTargets)
  return []
}

function isPackagedTextEntry(relative: string): boolean {
  if (relative === "README.md" || relative === "package.json" || relative === "cordis.patch.yml") return true
  return relative.startsWith("docs/") || relative.startsWith("assets/") || relative.startsWith("skills/")
}

afterAll(() => {
  if (scratchRoot) {
    rmSync(scratchRoot, { recursive: true, force: true })
    scratchRoot = undefined
    productArtifact = undefined
  }
})

describe("fronteira de empacotamento do piloto semântico (#182)", () => {
  test(
    "RED/GREEN: tarball real não inclui protocolo experimental, corpus, gabarito nem helpers",
    () => {
      const artifact = packedProduct()

      expect(findBoundaryViolations(artifact.entries)).toEqual([])
      expect(artifact.entries).not.toContain(PROTOCOL_RELATIVE_PATH)
      expect(artifact.entries.filter((entry) => entry.startsWith("tests/"))).toEqual([])
      expect(artifact.entries.some((entry) => entry.includes("semantic-pilot"))).toBe(false)

      // O material experimental continua versionado no repositório; só não é distribuído.
      expect(existsSync(path.join(REPO_ROOT, PROTOCOL_RELATIVE_PATH))).toBe(true)
      expect(
        existsSync(path.join(REPO_ROOT, EXPERIMENTAL_FIXTURE_RELATIVE_PATH, "v1", "manifest.json")),
      ).toBe(true)
      expect(
        existsSync(path.join(REPO_ROOT, EXPERIMENTAL_FIXTURE_RELATIVE_PATH, "v1", "answer-key", "provisional-ground-truth.json")),
      ).toBe(true)
    },
    { timeout: PACK_TEST_TIMEOUT_MS },
  )

  test(
    "conteúdo empacotado não antecipa respostas experimentais",
    () => {
      const artifact = packedProduct()
      const protocolSource = readFileSync(path.join(REPO_ROOT, PROTOCOL_RELATIVE_PATH), "utf8")
      for (const marker of ANSWER_ANTICIPATING_MARKERS) {
        // O protocolo é a fonte do material sensível: os marcadores precisam existir nele.
        expect(protocolSource.includes(marker), `marcador ${marker} ausente no protocolo de referência`).toBe(true)
      }

      const packagedTextEntries = artifact.entries.filter(isPackagedTextEntry)
      expect(packagedTextEntries.length).toBeGreaterThan(0)
      for (const relative of packagedTextEntries) {
        const content = readFileSync(path.join(artifact.packageRoot, relative), "utf8")
        for (const marker of ANSWER_ANTICIPATING_MARKERS) {
          expect(
            content.includes(marker),
            `${relative} antecipa material experimental (marcador: ${marker})`,
          ).toBe(false)
        }
      }
    },
    { timeout: PACK_TEST_TIMEOUT_MS },
  )

  test(
    "inclusões obrigatórias presentes e byte a byte idênticas à fonte",
    () => {
      const artifact = packedProduct()
      const sourcePackage = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"))
      const packedPackage = JSON.parse(readFileSync(path.join(artifact.packageRoot, "package.json"), "utf8"))

      expect(packedPackage.name).toBe("dshbanca")
      expect(packedPackage.private).toBe(true)
      expect(packedPackage.license).toBe("UNLICENSED")
      expect(packedPackage.main).toBe(sourcePackage.main)
      expect(packedPackage.types).toBe(sourcePackage.types)
      expect(packedPackage.exports).toEqual(sourcePackage.exports)
      expect(packedPackage.dsh).toEqual(sourcePackage.dsh)
      expect(packedPackage.dependencies).toEqual(sourcePackage.dependencies)
      expect(packedPackage.devDependencies).toEqual(sourcePackage.devDependencies)
      expect(packedPackage.files).toEqual(sourcePackage.files)

      expect(artifact.entries).toContain("package.json")
      expect(artifact.entries).toContain("README.md")
      expect(sha256File(path.join(artifact.packageRoot, "README.md"))).toBe(
        sha256File(path.join(REPO_ROOT, "README.md")),
      )

      // Entrypoints compilados e alvos de `exports` resolvem dentro do tarball e batem byte a byte.
      const exportTargets = new Set(
        [...collectExportTargets(sourcePackage.exports), sourcePackage.main, sourcePackage.types].map((target) =>
          String(target).replace(/^\.\//, ""),
        ),
      )
      for (const relative of exportTargets) {
        expect(artifact.entries, `alvo de export ausente no tarball: ${relative}`).toContain(relative)
        expect(statSync(path.join(artifact.packageRoot, relative)).size).toBeGreaterThan(0)
        expect(sha256File(path.join(artifact.packageRoot, relative))).toBe(
          sha256File(path.join(REPO_ROOT, relative)),
        )
      }
      for (const relative of REQUIRED_ENTRYPOINTS) {
        expect(artifact.entries, `entrypoint compilado ausente: ${relative}`).toContain(relative)
        expect(statSync(path.join(artifact.packageRoot, relative)).size).toBeGreaterThan(0)
      }

      // Patch Cordis preservado e íntegro.
      expect(artifact.entries).toContain("cordis.patch.yml")
      expect(sha256File(path.join(artifact.packageRoot, "cordis.patch.yml"))).toBe(
        sha256File(path.join(REPO_ROOT, "cordis.patch.yml")),
      )

      // Assets necessários preservados, incluindo o asset canônico do auditor.
      const repoAssets = walkRegularFiles(path.join(REPO_ROOT, "assets")).map((relative) => `assets/${relative}`)
      expect(repoAssets.length).toBeGreaterThan(0)
      expect(repoAssets).toContain("assets/dsh/agents/banca-auditor.md")
      for (const relative of repoAssets) {
        expect(artifact.entries, `asset ausente no tarball: ${relative}`).toContain(relative)
        expect(sha256File(path.join(artifact.packageRoot, relative))).toBe(sha256File(path.join(REPO_ROOT, relative)))
      }

      // Oito skills canônicas preservadas e íntegras.
      for (const skill of CANONICAL_SKILLS) {
        const relative = `skills/${skill}/SKILL.md`
        expect(artifact.entries, `skill canônica ausente: ${relative}`).toContain(relative)
        expect(sha256File(path.join(artifact.packageRoot, relative))).toBe(sha256File(path.join(REPO_ROOT, relative)))
      }

      // Documentação não experimental preservada e íntegra; o protocolo experimental fica de fora.
      const repoDocs = walkRegularFiles(path.join(REPO_ROOT, "docs"))
        .map((relative) => `docs/${relative}`)
        .filter((relative) => relative !== PROTOCOL_RELATIVE_PATH)
      expect(repoDocs.length).toBeGreaterThan(0)
      for (const relative of repoDocs) {
        expect(artifact.entries, `documentação não experimental ausente: ${relative}`).toContain(relative)
        expect(sha256File(path.join(artifact.packageRoot, relative))).toBe(sha256File(path.join(REPO_ROOT, relative)))
      }
    },
    { timeout: PACK_TEST_TIMEOUT_MS },
  )

  test(
    "controle negativo: reintroduzir o protocolo experimental na seleção é detectado",
    () => {
      const scratch = scratchDir()
      const sourcePackage = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"))
      const tamperedRoot = path.join(scratch, "tampered-tree")
      mkdirSync(path.join(tamperedRoot, "docs"), { recursive: true })

      const tamperedPackage = structuredClone(sourcePackage)
      tamperedPackage.files = sourcePackage.files.filter((pattern: string) => !pattern.startsWith("!"))
      expect(tamperedPackage.files).not.toEqual(sourcePackage.files)
      writeFileSync(path.join(tamperedRoot, "package.json"), `${JSON.stringify(tamperedPackage, null, 2)}\n`)
      cpSync(
        path.join(REPO_ROOT, PROTOCOL_RELATIVE_PATH),
        path.join(tamperedRoot, PROTOCOL_RELATIVE_PATH),
      )

      const tamperedArtifact = runNpmPack(tamperedRoot, scratch, "tampered")
      expect(tamperedArtifact.entries).toContain(PROTOCOL_RELATIVE_PATH)
      expect(findBoundaryViolations(tamperedArtifact.entries)).toContain(PROTOCOL_RELATIVE_PATH)

      // Sanidade do detector: uma seleção neutra não produz violação.
      expect(findBoundaryViolations(["package.json", "docs/usage.md", "skills/banca-avaliacao/SKILL.md"])).toEqual([])
    },
    { timeout: PACK_TEST_TIMEOUT_MS },
  )
})
