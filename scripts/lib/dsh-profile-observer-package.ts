import { copyFileSync, lstatSync } from "node:fs"
import { join } from "node:path"

const academicDecisionModuleRelativePath = join("dist", "lib", "academic_decision.js")

export function copyRequiredAcademicDecisionModule(repositoryRoot: string, observerRoot: string): void {
  const source = join(repositoryRoot, academicDecisionModuleRelativePath)
  let sourceStat: ReturnType<typeof lstatSync>
  try {
    sourceStat = lstatSync(source)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        "Required observer module dist/lib/academic_decision.js is missing; build the repository before creating the observer package",
      )
    }
    throw error
  }

  if (!sourceStat.isFile()) {
    throw new Error("Required observer module dist/lib/academic_decision.js is not a regular file")
  }

  copyFileSync(source, join(observerRoot, "academic_decision.js"))
}
