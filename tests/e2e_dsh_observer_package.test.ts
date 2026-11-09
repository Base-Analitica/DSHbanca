import { expect, test } from "bun:test"
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { copyRequiredAcademicDecisionModule } from "../scripts/lib/dsh-profile-observer-package.js"

const repositoryRoot = process.cwd()
const runnerSource = readFileSync(join(repositoryRoot, "scripts/e2e-dsh-profile.ts"), "utf8")

test("runner builds the required module before creating the scratch observer package", () => {
  const buildAt = runnerSource.indexOf('const build = await run(bunExecutable, ["run", "build"]')
  const observerPackageAt = runnerSource.indexOf("createObserverPackage(observerRoot")

  expect(buildAt).toBeGreaterThanOrEqual(0)
  expect(observerPackageAt).toBeGreaterThan(buildAt)
  expect(runnerSource).toContain("copyRequiredAcademicDecisionModule(repositoryRoot, observerRoot)")
  expect(runnerSource).toContain('await import("./academic_decision.js")')
  expect(runnerSource).not.toContain("if (existsSync(academicDecisionDist))")
})

test("fails explicitly and leaves the observer package incomplete when the build artifact is missing", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "dshbanca-observer-missing-artifact-"))
  const cleanCheckoutRoot = join(temporaryRoot, "clean-checkout")
  const observerRoot = join(temporaryRoot, "observer")
  const observerModulePath = join(observerRoot, "academic_decision.js")

  try {
    mkdirSync(cleanCheckoutRoot, { recursive: true })
    mkdirSync(observerRoot, { recursive: true })
    expect(existsSync(join(cleanCheckoutRoot, "dist"))).toBe(false)
    expect(() => copyRequiredAcademicDecisionModule(cleanCheckoutRoot, observerRoot)).toThrow(
      "Required observer module dist/lib/academic_decision.js is missing",
    )
    expect(existsSync(observerModulePath)).toBe(false)
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
})

test("builds and loads the academic decision module from a clean checkout into scratch", async () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "dshbanca-observer-clean-checkout-"))
  const cleanCheckoutRoot = join(temporaryRoot, "clean-checkout")
  const distRoot = join(cleanCheckoutRoot, "dist")
  const artifactPath = join(distRoot, "lib", "academic_decision.js")
  const observerRoot = join(temporaryRoot, "observer")
  const observerModulePath = join(observerRoot, "academic_decision.js")
  const observerIndexPath = join(observerRoot, "index.js")

  try {
    mkdirSync(cleanCheckoutRoot, { recursive: true })
    mkdirSync(observerRoot, { recursive: true })
    cpSync(join(repositoryRoot, "src"), join(cleanCheckoutRoot, "src"), { recursive: true })
    for (const filename of ["package.json", "tsconfig.json", "bun.lock"]) {
      copyFileSync(join(repositoryRoot, filename), join(cleanCheckoutRoot, filename))
    }
    symlinkSync(join(repositoryRoot, "node_modules"), join(cleanCheckoutRoot, "node_modules"), "dir")

    expect(existsSync(distRoot)).toBe(false)
    const build = spawnSync(process.execPath, ["run", "build"], {
      cwd: cleanCheckoutRoot,
      encoding: "utf8",
      timeout: 120_000,
    })
    expect(build.error).toBeUndefined()
    expect(build.status).toBe(0)
    expect(existsSync(artifactPath)).toBe(true)

    copyRequiredAcademicDecisionModule(cleanCheckoutRoot, observerRoot)
    expect(readFileSync(observerModulePath)).toEqual(readFileSync(artifactPath))
    writeFileSync(join(observerRoot, "package.json"), JSON.stringify({ type: "module", main: "./index.js" }))
    writeFileSync(observerIndexPath, 'export const academicModule = await import("./academic_decision.js")\n')

    const loadedObserver = await import(`${pathToFileURL(observerIndexPath).href}?test=${Date.now()}`)
    expect(typeof loadedObserver.academicModule.formatAcademicDecisionQuestion).toBe("function")
    expect(typeof loadedObserver.academicModule.processAcademicDecisionAnswer).toBe("function")
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
})
