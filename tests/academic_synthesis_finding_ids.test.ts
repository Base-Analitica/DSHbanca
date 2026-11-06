import { describe, expect, test } from "bun:test"
import { findUnallowlistedSynthesisFindingIds } from "../src/lib/academic_synthesis_finding_ids"

const allowedFindingId = "fid-verified-001"
const allowedFingerprint = "d".repeat(64)
const allowedHash = "a".repeat(64)

/*
 * This is a lexical signal only. An ordinary inline-code token such as
 * `analysis` can be a false positive; an unlabelled non-hex ID outside code
 * formatting can be a false negative. Neither result evaluates evidence,
 * claims, source lines, or scientific truth.
 */
describe("findUnallowlistedSynthesisFindingIds", () => {
  test("returns no candidates for empty text, empty allowlist, or unrelated prose", () => {
    expect(findUnallowlistedSynthesisFindingIds("", [allowedFindingId])).toEqual([])
    expect(findUnallowlistedSynthesisFindingIds("\n \t", [])).toEqual([])
    expect(
      findUnallowlistedSynthesisFindingIds(
        "A síntese descreve relações entre método e resultados sem citar identificadores.",
        [allowedFindingId],
      ),
    ).toEqual([])
  })

  test("signals unallowlisted IDs explicitly labeled with equals or colon", () => {
    const text = [
      `findingId=${allowedFindingId}`,
      'findingId : "fid-invented-002"',
      "FINDINGID:\t'fid-invented-003'",
    ].join("; ")

    expect(findUnallowlistedSynthesisFindingIds(text, [allowedFindingId])).toEqual([
      "fid-invented-002",
      "fid-invented-003",
    ])
  })

  test("recognizes delimited identifiers in backticks and complete bare SHA-256 tokens", () => {
    const inventedHash = "b".repeat(64)
    const text = [
      `Allowed reference: \`${allowedFindingId}\`.`,
      "An unrelated lexical token: `fid-invented-004`,",
      `A separate hash: (${inventedHash}).`,
      `Another allowed hash: [${allowedHash}]`,
    ].join(" ")

    expect(
      findUnallowlistedSynthesisFindingIds(text, [allowedFindingId, allowedHash]),
    ).toEqual(["fid-invented-004", inventedHash])
  })

  test("compares complete SHA-256 identifiers without case sensitivity", () => {
    expect(
      findUnallowlistedSynthesisFindingIds(
        `findingId=${allowedHash.toUpperCase()}`,
        [allowedHash],
      ),
    ).toEqual([])

    const invalidHash = "c".repeat(64)
    expect(
      findUnallowlistedSynthesisFindingIds(
        `findingId:${invalidHash.toUpperCase()}`,
        [allowedHash],
      ),
    ).toEqual([invalidHash.toUpperCase()])
  })

  test("keeps non-hex identifier comparisons exact", () => {
    expect(
      findUnallowlistedSynthesisFindingIds(
        "findingId=fid-Verified-001; findingId=fid-verified-001",
        ["fid-Verified-001"],
      ),
    ).toEqual(["fid-verified-001"])
  })

  test("allows incidental fingerprint and plan IDs but not their findingId labels", () => {
    const planId = "plan-synthetic-009"
    const text = [
      `Fingerprint context: ${allowedFingerprint},`,
      `quoted fingerprint: \`${allowedFingerprint}\`.`,
      `Plan context: \`${planId}\`.`,
      `Mislabelled reference: findingId=${allowedFingerprint}.`,
      `Another mislabelled reference: findingId:${planId}.`,
    ].join(" ")

    expect(
      findUnallowlistedSynthesisFindingIds(
        text,
        [allowedFindingId],
        [allowedFingerprint, planId],
      ),
    ).toEqual([allowedFingerprint, planId])
  })

  test("does not let a valid ID hide another invalid ID", () => {
    const text = `findingId=${allowedFindingId} and findingId:fid-not-validated-005`
    expect(findUnallowlistedSynthesisFindingIds(text, [allowedFindingId])).toEqual([
      "fid-not-validated-005",
    ])
  })

  test("deduplicates repeated IDs while preserving first-seen order", () => {
    const text = [
      "findingId=fid-invented-006",
      "findingId:fid-invented-006",
      "`fid-invented-006`",
      "findingId=fid-invented-007",
      "findingId=fid-invented-006",
    ].join("; ")

    expect(findUnallowlistedSynthesisFindingIds(text, [])).toEqual([
      "fid-invented-006",
      "fid-invented-007",
    ])
  })

  test("does not accept SHA-256 substrings with adjacent identifier characters", () => {
    const hash = "e".repeat(64)
    const text = `prefix${hash} suffix-${hash}-tail x${hash}y ${hash.slice(0, 63)}`
    expect(findUnallowlistedSynthesisFindingIds(text, [])).toEqual([])
  })

  test("documents a false positive and a false negative from lexical boundaries", () => {
    // Ordinary inline code meets the identifier-shaped pattern and is only a signal.
    expect(findUnallowlistedSynthesisFindingIds("Use `analysis` as a heading.", [])).toEqual([
      "analysis",
    ])
    // Non-hex IDs outside a label or code token are intentionally not guessed.
    expect(
      findUnallowlistedSynthesisFindingIds("The reference code is plan-unknown-010.", []),
    ).toEqual([])
  })

  test("does not recognize truncated or merely similar SHA-256 tokens", () => {
    const hash = "f".repeat(64)
    const nearMatches = [
      hash.slice(0, 63),
      `${hash.slice(0, 63)}g`,
      `${hash.slice(0, 32)}-${hash.slice(32)}`,
    ]

    expect(findUnallowlistedSynthesisFindingIds(nearMatches.join("; "), [])).toEqual([])
    expect(
      findUnallowlistedSynthesisFindingIds(`\`${hash.slice(0, 63)}\``, []),
    ).toEqual([])

    // A similar but complete digest is a distinct ID, not an allowlist match.
    const differentCompleteHash = "f".repeat(63) + "e"
    expect(
      findUnallowlistedSynthesisFindingIds(differentCompleteHash, [hash]),
    ).toEqual([differentCompleteHash])
  })

  test("treats punctuation and whitespace as delimiters but not partial code tokens", () => {
    const text = `\n  findingId = fid-bad-008, and \`fid-bad-009\`!\t`
    expect(findUnallowlistedSynthesisFindingIds(text, [])).toEqual([
      "fid-bad-008",
      "fid-bad-009",
    ])
  })
})
