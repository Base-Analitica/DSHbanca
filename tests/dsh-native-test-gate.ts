import { isAbsolute } from "node:path"

export const DSH_NATIVE_TEST_AUTHORIZATION_ENV = "DSHBANCA_DSH_NATIVE_TEST_AUTHORIZED"
export const DSH_TEST_HOST_PACKAGE_ENV = "DSH_TEST_HOST_PACKAGE"

type TestEnvironment = Readonly<Record<string, string | undefined>>

export type DshNativeTestGate =
  | { mode: "none" }
  | { mode: "blocked"; reason: string }
  | { mode: "authorized"; hostPackage: string }

/**
 * Selects whether a test may enter the native DSH path. This function is pure:
 * it does not inspect PATH, resolve executables, read files, or import packages.
 */
export function selectDshNativeTestGate(env: TestEnvironment): DshNativeTestGate {
  const authorization = env[DSH_NATIVE_TEST_AUTHORIZATION_ENV]
  const hostPackage = env[DSH_TEST_HOST_PACKAGE_ENV]

  if (authorization === undefined && hostPackage === undefined) {
    return { mode: "none" }
  }

  if (authorization !== "yes") {
    return {
      mode: "blocked",
      reason: authorization === undefined
        ? `${DSH_TEST_HOST_PACKAGE_ENV} requires ${DSH_NATIVE_TEST_AUTHORIZATION_ENV}=yes`
        : `${DSH_NATIVE_TEST_AUTHORIZATION_ENV} must be exactly yes`,
    }
  }

  if (hostPackage === undefined || hostPackage.trim().length === 0) {
    return {
      mode: "blocked",
      reason: `${DSH_NATIVE_TEST_AUTHORIZATION_ENV}=yes requires an explicit ${DSH_TEST_HOST_PACKAGE_ENV}`,
    }
  }

  if (hostPackage !== hostPackage.trim() || !isAbsolute(hostPackage)) {
    return {
      mode: "blocked",
      reason: `${DSH_TEST_HOST_PACKAGE_ENV} must be an absolute package.json path`,
    }
  }

  return { mode: "authorized", hostPackage }
}
