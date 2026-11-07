import { describe, expect, test } from "bun:test"
import { isSynthesisFindingIdCited } from "../src/lib/academic_synthesis_cited_finding_ids"

const sha256 = "0123456789abcdef".repeat(4)
const otherSha256 = "f".repeat(64)

/*
 * A positive result is only a lexical signal. An incidental mention of the exact
 * token can be a false positive; an alias or semantic reference without the
 * literal ID can be a false negative. Neither verifies a finding, source, claim,
 * manuscript content, or academic conclusion.
 */
describe("isSynthesisFindingIdCited", () => {
  test("recognizes a complete SHA-256 token and ignores hexadecimal case", () => {
    expect(isSynthesisFindingIdCited(sha256, sha256)).toBe(true)
    expect(isSynthesisFindingIdCited(`findingId=${sha256.toUpperCase()}`, sha256)).toBe(true)
    expect(isSynthesisFindingIdCited(`(${sha256.toUpperCase()}).`, sha256)).toBe(true)
  })

  test("recognizes exact non-hash IDs without changing their case", () => {
    expect(isSynthesisFindingIdCited("fid.alpha-1", "fid.alpha-1")).toBe(true)
    expect(isSynthesisFindingIdCited("citação: fid_α.beta-1;", "fid_α.beta-1")).toBe(true)
    expect(isSynthesisFindingIdCited("FID.alpha-1", "fid.alpha-1")).toBe(false)
    expect(isSynthesisFindingIdCited("fid.alpha-1", "FID.alpha-1")).toBe(false)

    const longNonHashId = "g".repeat(64)
    expect(isSynthesisFindingIdCited(longNonHashId, longNonHashId)).toBe(true)
    expect(isSynthesisFindingIdCited(longNonHashId.toUpperCase(), longNonHashId)).toBe(false)
  })

  test("accepts complete tokens at window edges and around ordinary punctuation", () => {
    const findingId = "fid.alpha-1"
    for (const windowText of [
      findingId,
      `before ${findingId}`,
      `${findingId} after`,
      `findingId=${findingId}, next`,
      `\`${findingId}\``,
      `"${findingId}"`,
      `'${findingId}'`,
      `(${findingId})`,
      `[${findingId}];`,
      `...${findingId}...`,
      `${findingId}.`,
    ]) {
      expect(isSynthesisFindingIdCited(windowText, findingId)).toBe(true)
    }
  })

  test("rejects prefixes, suffixes, paths, and punctuated token continuations", () => {
    const findingId = "fid-1"
    for (const windowText of [
      "fid-10",
      "xfid-1",
      "fid-1a",
      "fid-1_suffix",
      "αfid-1",
      "fid-1β",
      `fid-1\u0301`,
      "path/fid-1",
      "fid-1/filha",
      "fid-1\\filha",
      "fid-1.2",
      "fid-1..2",
      "prefix..fid-1",
      "fid-1...suffix",
    ]) {
      expect(isSynthesisFindingIdCited(windowText, findingId)).toBe(false)
    }
  })

  test("treats a terminal period run as punctuation, not an extended ID", () => {
    expect(isSynthesisFindingIdCited("fid-1.", "fid-1")).toBe(true)
    expect(isSynthesisFindingIdCited("fid-1...", "fid-1")).toBe(true)
    expect(isSynthesisFindingIdCited("fid-1...2", "fid-1")).toBe(false)
    expect(isSynthesisFindingIdCited("prefix...fid-1", "fid-1")).toBe(false)
    expect(isSynthesisFindingIdCited("...fid-1", "fid-1")).toBe(true)
  })

  test("rejects incomplete, extended, or different SHA-256 tokens", () => {
    const nearMatches = [
      sha256.slice(0, 63),
      `${sha256}a`,
      `${sha256}0`,
      `${sha256}_suffix`,
      `${sha256}-suffix`,
      `${sha256}/child`,
      `${sha256.slice(0, 63)}\u0301`,
      otherSha256,
    ]

    for (const windowText of nearMatches) {
      expect(isSynthesisFindingIdCited(windowText, sha256)).toBe(false)
    }
  })

  test("rejects a 63-character hexadecimal expected ID", () => {
    const truncated = "a".repeat(63)
    expect(isSynthesisFindingIdCited(`findingId=${truncated}`, truncated)).toBe(false)
  })

  test("rejects a 65-character hexadecimal expected ID", () => {
    const extended = "f".repeat(65)
    expect(isSynthesisFindingIdCited(`findingId=${extended}`, extended)).toBe(false)
  })

  test("requires the expected ID rather than any other allowed-looking ID", () => {
    expect(
      isSynthesisFindingIdCited("fid.allowed-2 and fid.allowed-3", "fid.allowed-1"),
    ).toBe(false)
    expect(
      isSynthesisFindingIdCited("fid.allowed-2, then fid.allowed-1.", "fid.allowed-1"),
    ).toBe(true)
  })

  test("fails closed for empty, whitespace-padded, and runtime-invalid values", () => {
    const isCited = isSynthesisFindingIdCited as (
      windowText: unknown,
      findingId: unknown,
    ) => boolean

    for (const [windowText, findingId] of [
      ["", "fid-1"],
      [" \t\n ", "fid-1"],
      ["fid-1", ""],
      ["fid-1", " \t\n "],
      ["fid-1", " fid-1"],
      ["fid-1", "fid-1 "],
      [null, "fid-1"],
      [undefined, "fid-1"],
      [1, "fid-1"],
      ["fid-1", null],
      ["fid-1", undefined],
      ["fid-1", 1],
    ] as const) {
      expect(() => isCited(windowText, findingId)).not.toThrow()
      expect(isCited(windowText, findingId)).toBe(false)
    }
  })

  test("does not normalize Unicode or infer an alias", () => {
    expect(isSynthesisFindingIdCited("fid.α-1", "fid.α-1")).toBe(true)
    expect(isSynthesisFindingIdCited("fid.α-1", "fid.α-2")).toBe(false)
    expect(isSynthesisFindingIdCited("café-1", "cafe\u0301-1")).toBe(false)
  })

  test("documents an incidental lexical false positive and an alias false negative", () => {
    // The exact token is present in an unrelated inventory, so this is still true.
    expect(isSynthesisFindingIdCited("Inventory: fid-incidental-4", "fid-incidental-4")).toBe(true)
    // A prose alias has no literal findingId token and is not inferred.
    expect(isSynthesisFindingIdCited("the first methods finding", "fid-methods-1")).toBe(false)
  })
})
