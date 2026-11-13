import { describe, test, expect } from "bun:test"
import { parseBibtex, bibEntryToRef, BibtexParseError, type BibtexErrorKind } from "../src/lib/bibtex"

/** Run parseBibtex expecting a BibtexParseError; fail the test otherwise. */
function parseFailure(content: string): BibtexParseError {
  try {
    parseBibtex(content)
  } catch (err) {
    expect(err).toBeInstanceOf(BibtexParseError)
    return err as BibtexParseError
  }
  throw new Error("expected parseBibtex to reject invalid BibTeX, but it returned normally")
}

function expectParseFailure(content: string, kind: BibtexErrorKind, pattern: RegExp): void {
  const error = parseFailure(content)
  expect(error.kind).toBe(kind)
  expect(error.message).toMatch(pattern)
}

describe("parseBibtex", () => {
  test("parses article entries", () => {
    const content = `
@article{autor2020,
  author = {Silva, J. and Santos, M.},
  title = {Estudo sobre algo},
  journal = {Revista Científica},
  year = {2020},
  doi = {10.1000/xyz123},
}

@inproceedings{outro2021,
  author = {Costa, A.},
  title = {Outro estudo},
  booktitle = {Anais do Evento},
  year = {2021},
}
`
    const entries = parseBibtex(content)
    expect(entries.length).toBe(2)
    expect(entries[0].type).toBe("article")
    expect(entries[0].key).toBe("autor2020")
    expect(entries[0].fields.title).toBe("Estudo sobre algo")
    expect(entries[0].fields.doi).toBe("10.1000/xyz123")
    expect(entries[1].key).toBe("outro2021")
  })

  test("handles empty input", () => {
    expect(parseBibtex("")).toEqual([])
  })

  test("bibEntryToRef maps fields correctly", () => {
    const entries = parseBibtex(`
@article{test2022,
  author = {Foo, Bar and Baz, Qux},
  title = {Test Title},
  journal = {Test Journal},
  year = {2022},
  doi = {https://doi.org/10.1234/test},
}
`)
    const ref = bibEntryToRef(entries[0])
    expect(ref.key).toBe("test2022")
    expect(ref.title).toBe("Test Title")
    expect(ref.authors).toEqual(["Foo, Bar", "Baz, Qux"])
    expect(ref.year).toBe(2022)
    expect(ref.doi).toBe("10.1234/test")
    expect(ref.journal).toBe("Test Journal")
  })
})

// ---------------------------------------------------------------------------
// Issue #111 — balanced fields, quoted values and escaped content.
// Positives below assert the observable contract from the issue; negatives
// assert that malformed or unsupported syntax fails with an identifiable
// error instead of silently returning truncated fields.
// ---------------------------------------------------------------------------

describe("parseBibtex — issue #111 regression fixture", () => {
  const issueFixture = `@article{exemplo,
  title = {Estudo da {ABNT} no {Brasil}},
  author = {Gon{\\c{c}}alves},
  journal = "Revista",
  year = {2026}
}
`

  test("preserves nested braces and quoted values from the issue fixture", () => {
    const entries = parseBibtex(issueFixture)

    expect(entries).toHaveLength(1)
    expect(entries[0].type).toBe("article")
    expect(entries[0].key).toBe("exemplo")
    expect(entries[0].fields.title).toBe("Estudo da {ABNT} no {Brasil}")
    expect(entries[0].fields.author).toBe("Gon{\\c{c}}alves")
    expect(entries[0].fields.journal).toBe("Revista")
    expect(entries[0].fields.year).toBe("2026")
  })

  test("carries the complete fixture metadata into bibEntryToRef", () => {
    const ref = bibEntryToRef(parseBibtex(issueFixture)[0])

    expect(ref.key).toBe("exemplo")
    expect(ref.title).toBe("Estudo da {ABNT} no {Brasil}")
    expect(ref.authors).toEqual(["Gon{\\c{c}}alves"])
    expect(ref.journal).toBe("Revista")
    expect(ref.year).toBe(2026)
  })
})

describe("parseBibtex — quoted values, escapes and LaTeX commands", () => {
  test("parses quoted values and preserves escaped quotes verbatim", () => {
    const entries = parseBibtex(`@article{quoted2026,
  author = {Souza, Ana},
  title = "Estudo \\"comparativo\\" de {ABNT}",
  journal = "Revista Brasileira",
  year = 2026,
  note = "Aspas internas: \\"x\\" e chaves {protegidas}",
}
`)

    expect(entries).toHaveLength(1)
    expect(entries[0].fields.title).toBe('Estudo \\"comparativo\\" de {ABNT}')
    expect(entries[0].fields.journal).toBe("Revista Brasileira")
    expect(entries[0].fields.year).toBe("2026")
    expect(entries[0].fields.note).toBe('Aspas internas: \\"x\\" e chaves {protegidas}')
  })

  test("maps a quoted DOI through bibEntryToRef", () => {
    const entries = parseBibtex('@article{quotedDoi,\n  title = {T},\n  doi = "10.1234/quoted",\n  year = 2024,\n}')
    expect(bibEntryToRef(entries[0]).doi).toBe("10.1234/quoted")
  })

  test("preserves LaTeX commands and escaped braces without interpreting them", () => {
    const entries = parseBibtex(`@article{latex2020,
  author = {Gon{\\c{c}}alves, M. and Jos{\\'e}, R.},
  title = {Uso de \\{chaves\\} e prote{\\c c}{\\~a}o},
  note = {Barra final escapada \\} literal},
}
`)

    expect(entries[0].fields.author).toBe("Gon{\\c{c}}alves, M. and Jos{\\'e}, R.")
    expect(entries[0].fields.title).toBe("Uso de \\{chaves\\} e prote{\\c c}{\\~a}o")
    expect(entries[0].fields.note).toBe("Barra final escapada \\} literal")
  })

  test("preserves deeply nested brace groups", () => {
    const entries = parseBibtex("@misc{deep,\n  title = {A {B {C}} D},\n}\n")
    expect(entries[0].fields.title).toBe("A {B {C}} D")
  })
})

describe("parseBibtex — delimiter characters inside values", () => {
  test("preserves @, commas and equals signs inside braced values", () => {
    const entries = parseBibtex(`@misc{sintetica2025,
  title = {Contato: pessoa@example.org, comparação x = y, z},
  note = {Lista: {a, b}, {c = d}},
}
`)

    expect(entries[0].fields.title).toBe("Contato: pessoa@example.org, comparação x = y, z")
    expect(entries[0].fields.note).toBe("Lista: {a, b}, {c = d}")
  })

  test("preserves @, commas and equals signs inside quoted values", () => {
    const entries = parseBibtex(`@misc{quoted2025,
  title = "Contato: pessoa@example.org, x = y",
}
`)

    expect(entries[0].fields.title).toBe("Contato: pessoa@example.org, x = y")
  })
})

describe("parseBibtex — multiple entries and existing normalization", () => {
  test("parses multiple entries preserving order, types, keys and fields", () => {
    const entries = parseBibtex(`@article{primeira2020,
  title = {Primeira},
}
@book{segunda2021,
  title = {Segunda {com} chaves},
}
@misc{terceira2022,
  title = "Terceira",
}
`)

    expect(entries.map((e) => e.key)).toEqual(["primeira2020", "segunda2021", "terceira2022"])
    expect(entries.map((e) => e.type)).toEqual(["article", "book", "misc"])
    expect(entries[1].fields.title).toBe("Segunda {com} chaves")
    expect(entries[2].fields.title).toBe("Terceira")
  })

  test("keeps existing normalization of entry types and field names", () => {
    const entries = parseBibtex("@ARTICLE{ChaveMista,\n  TITLE = {  Espaços  },\n  Year = 2024,\n}")

    expect(entries).toHaveLength(1)
    expect(entries[0].type).toBe("article")
    expect(entries[0].key).toBe("ChaveMista")
    expect(entries[0].fields.title).toBe("Espaços")
    expect(entries[0].fields.year).toBe("2024")
    expect(entries[0].fields.TITLE).toBeUndefined()
  })

  test("accepts parenthesized entries and trailing commas", () => {
    const entries = parseBibtex("@article(paren2024,\n  title = {Parênteses},\n  year = 2024,\n)")

    expect(entries).toHaveLength(1)
    expect(entries[0].type).toBe("article")
    expect(entries[0].key).toBe("paren2024")
    expect(entries[0].fields.title).toBe("Parênteses")
    expect(entries[0].fields.year).toBe("2024")
  })

  test("accepts quoted and braced values for traditional entry types", () => {
    const entries = parseBibtex(`@inproceedings{tradicional2021,
  author = {Costa, A.},
  title = {Outro estudo},
  booktitle = "Anais do Evento",
  year = {2021},
}
`)

    const ref = bibEntryToRef(entries[0])
    expect(ref.authors).toEqual(["Costa, A."])
    expect(ref.title).toBe("Outro estudo")
    expect(ref.journal).toBe("Anais do Evento")
    expect(ref.year).toBe(2021)
  })

  test("accepts an empty field list", () => {
    const entries = parseBibtex("@misc{vazio,}")
    expect(entries).toHaveLength(1)
    expect(entries[0].key).toBe("vazio")
    expect(entries[0].fields).toEqual({})
  })

  test("handles CRLF line endings", () => {
    const entries = parseBibtex("@article{crlf2024,\r\n  title = {Linha única},\r\n  year = {2024},\r\n}\r\n")
    expect(entries).toHaveLength(1)
    expect(entries[0].fields.title).toBe("Linha única")
    expect(entries[0].fields.year).toBe("2024")
  })
})

describe("parseBibtex — text outside entries and directives", () => {
  test("ignores text outside entries and deliberately skips @comment and @preamble", () => {
    const entries = parseBibtex(`% cabeçalho sintético sem referências
texto solto entre entradas
@comment{Bloco ignorado: @article{falsa, title = {não é referência}}}
@preamble{"\\newcommand{\\noopsort}[1]{}"}
@article{real2026,
  title = {Referência real},
}
`)

    expect(entries).toHaveLength(1)
    expect(entries[0].key).toBe("real2026")
    expect(entries[0].fields.title).toBe("Referência real")
  })

  test("returns an empty array for empty, whitespace-only and comment-only files", () => {
    expect(parseBibtex("")).toEqual([])
    expect(parseBibtex("   \n\t\r\n")).toEqual([])
    expect(parseBibtex("% apenas comentário\nlinha comum sem arroba\n")).toEqual([])
  })
})

describe("parseBibtex — malformed and unsupported input fails explicitly", () => {
  test("rejects an unclosed braced value", () => {
    expectParseFailure("@article{broken,\n  title = {sem fechamento", "malformed", /unbalanced|unterminated/i)
  })

  test("rejects an unterminated quoted value", () => {
    expectParseFailure('@article{broken,\n  title = "sem aspas finais', "malformed", /unterminated|quoted/i)
  })

  test("rejects mismatched entry delimiters", () => {
    expectParseFailure("@article{broken,\n  title = {A})", "malformed", /expected|delimiter|malformed/i)
  })

  test("rejects a malformed field without '='", () => {
    expectParseFailure("@article{broken,\n  title {A}\n}", "malformed", /expected '='|malformed/i)
  })

  test("rejects an invalid entry between valid entries without returning partial results", () => {
    const content = `@article{ok1,
  title = {Primeira válida},
}
@article{broken,
  title = {Segunda sem fechamento}
@article{ok2,
  title = {Terceira válida},
}
`
    expectParseFailure(content, "malformed", /unexpected '@'|unterminated|malformed/i)
    expect(() => parseBibtex(content)).toThrow(BibtexParseError)
  })

  test("rejects @string macro definitions as unsupported", () => {
    expectParseFailure('@string{jan = "January"}', "unsupported", /not supported|unsupported/i)
  })

  test("rejects bare macro values as unsupported", () => {
    expectParseFailure("@article{macro,\n  month = jan,\n}", "unsupported", /macro .*not supported|not supported/i)
  })

  test("rejects BibTeX string concatenation with '#' as unsupported", () => {
    expectParseFailure('@article{concat,\n  title = "A" # "B",\n}', "unsupported", /concatenation .*not supported|not supported/i)
  })

  test("rejects a bare @ outside an entry instead of ignoring it silently", () => {
    expectParseFailure("contato@example.org fora de uma entrada", "malformed", /entry type|expected/i)
  })

  test("rejects duplicate fields", () => {
    expectParseFailure("@article{dup,\n  title = {A},\n  title = {B},\n}", "malformed", /duplicate field/i)
  })

  test("rejects an entry without the key/fields comma", () => {
    expectParseFailure("@article{apenasChave}", "malformed", /comma|key/i)
  })

  test("rejects an entry without a type", () => {
    expectParseFailure("@ {x}", "malformed", /entry type|expected/i)
  })

  test("does not report an invalid file as an empty parse", () => {
    const error = parseFailure("@article{quebrada,\n  title = {A},\n")
    expect(error.kind).toBe("malformed")
    expect(error.message).toMatch(/unterminated|malformed|unbalanced/i)
    expect(parseBibtex("")).toEqual([])
  })

  test("exposes name, kind, line, column and offset on parse errors", () => {
    const error = parseFailure("@article{quebrada,\n  title = {A,\n")
    expect(error.name).toBe("BibtexParseError")
    expect(error).toBeInstanceOf(Error)
    expect(error.kind).toBe("malformed")
    expect(error.line).toBe(2)
    expect(error.column).toBeGreaterThan(0)
    expect(error.offset).toBeGreaterThan(0)
    expect(error.message).toMatch(/line \d+/i)
    expect(error.message).toMatch(/column \d+/i)
  })
})

// ---------------------------------------------------------------------------
// R1 remediation (maintainer review of PR #116): parenthesized directives must
// respect protected value contexts and must never leak ghost references; entry
// keys get minimal lexical validation independent of the entry delimiter.
// ---------------------------------------------------------------------------

describe("parseBibtex — directives never leak references (R1)", () => {
  test("P1.1: quoted literal in parenthesized @preamble does not expose a ghost entry", () => {
    const entries = parseBibtex(`@preamble("x) @article{fantasma, title={Não é referência}} (x")
@article{real, title={Real}}
`)

    expect(entries.map((entry) => entry.key)).toEqual(["real"])
    expect(entries).toHaveLength(1)
    expect(entries[0].fields.title).toBe("Real")
  })

  test("P1.2: braced literal in parenthesized @comment does not expose a ghost entry", () => {
    const entries = parseBibtex(`@comment(ignored {x) @article{fantasma, title={Não é referência}} (x})
@article{real, title={Real}}
`)

    expect(entries.map((entry) => entry.key)).toEqual(["real"])
    expect(entries).toHaveLength(1)
  })

  test("P1.3: opening parenthesis inside a quoted literal does not unbalance the directive", () => {
    const entries = parseBibtex(`@preamble("A (")
@article{real,title={Real}}
`)

    expect(entries.map((entry) => entry.key)).toEqual(["real"])
    expect(entries).toHaveLength(1)
  })

  test("brace-delimited directives protect quoted literals containing the closing brace", () => {
    const entries = parseBibtex(`@comment{"} @article{fantasma, title={Não é referência}}"}
@preamble{"\\newcommand{\\x}{y}"}
@article{real, title={Real}}
`)

    expect(entries.map((entry) => entry.key)).toEqual(["real"])
    expect(entries).toHaveLength(1)
    expect(entries[0].fields.title).toBe("Real")
  })

  test("escaped delimiters inside directives do not close them", () => {
    const entries = parseBibtex(`@comment(texto com \\) parêntese escapado)
@preamble("A \\( B")
@article{real,title={Real}}
`)

    expect(entries.map((entry) => entry.key)).toEqual(["real"])
    expect(entries).toHaveLength(1)
  })

  test("nested parentheses inside parenthesized directives remain balanced", () => {
    const entries = parseBibtex(`@comment(ignorar (aninhado) e mais)
@article{real,title={Real}}
`)

    expect(entries.map((entry) => entry.key)).toEqual(["real"])
    expect(entries).toHaveLength(1)
  })

  test("unterminated brace-delimited directive between valid entries fails closed", () => {
    expectParseFailure(`@article{ok1, title={A}}
@comment{diretiva sem fechamento
@article{ok2, title={B}}
`, "malformed", /unterminated @comment/i)
  })

  test("unterminated quoted parenthesized directive between valid entries fails closed", () => {
    expectParseFailure(`@article{ok1, title={A}}
@preamble("sem fechamento
@article{ok2, title={B}}
`, "malformed", /unterminated @preamble/i)
  })

  test("unterminated parenthesized directive without literals fails closed", () => {
    expectParseFailure(`@article{ok1, title={A}}
@comment(diretiva sem fechamento
`, "malformed", /unterminated @comment/i)
  })
})

describe("parseBibtex — citation key lexical validation (R1)", () => {
  test("rejects structural delimiters in parenthesized entry keys", () => {
    expectParseFailure("@article(bad{key, title={A})", "malformed", /citation key/i)
    expectParseFailure("@article(bad}key, title={A})", "malformed", /citation key/i)
    expectParseFailure("@article(bad(key, title={A})", "malformed", /citation key/i)
    expectParseFailure("@article(bad)key, title={A})", "malformed", /citation key/i)
  })

  test("rejects structural delimiters in braced entry keys", () => {
    expectParseFailure("@article{bad{key, title={A}}", "malformed", /citation key/i)
    expectParseFailure("@article{bad}key, title={A}}", "malformed", /citation key/i)
    expectParseFailure("@article{bad(key, title={A}}", "malformed", /citation key/i)
    expectParseFailure("@article{bad)key, title={A}}", "malformed", /citation key/i)
  })

  test("rejects quotes and internal whitespace in citation keys", () => {
    expectParseFailure('@article{bad"key, title={A}}', "malformed", /citation key/i)
    expectParseFailure("@article(bad\"key, title={A})", "malformed", /citation key/i)
    expectParseFailure("@article{bad key, title={A}}", "malformed", /citation key/i)
    expectParseFailure("@article(bad\tkey, title={A})", "malformed", /citation key/i)
  })

  test("accepts legitimate traditional and punctuated keys in both entry delimiters", () => {
    const entries = parseBibtex(`@article{autor2020, title = {A}}
@book(10.1000/xyz-1, title = {B})
@misc{chave_com:pontos-e.pontos, title = {C}}
@inproceedings(Chave-Mista:2024, title = {D})
`)

    expect(entries.map((entry) => entry.key)).toEqual([
      "autor2020",
      "10.1000/xyz-1",
      "chave_com:pontos-e.pontos",
      "Chave-Mista:2024",
    ])
    expect(entries.map((entry) => entry.type)).toEqual(["article", "book", "misc", "inproceedings"])
  })

  test("keeps trimming surrounding whitespace in keys for both entry delimiters", () => {
    const entries = parseBibtex("@article{  chave2020  , title = {A}}\n@book(  outra2021  , title = {B})")
    expect(entries.map((entry) => entry.key)).toEqual(["chave2020", "outra2021"])
  })
})

// ---------------------------------------------------------------------------
// R2 remediation (maintainer re-review of PR #116): @preamble follows the same
// brace-balanced fail-closed contract as field values. A closing brace without
// a matching opening brace is malformed; @comment remains deliberately opaque.
// ---------------------------------------------------------------------------

describe("parseBibtex — @preamble rejects unmatched closing braces (R2)", () => {
  test("rejects a closing brace inside a quoted preamble literal without an opening brace", () => {
    expectParseFailure(`@preamble("}")
@article{real,title={Real}}
`, "malformed", /unexpected '}'|@preamble/i)
  })

  test("rejects a closing brace inside a quoted brace-delimited preamble literal", () => {
    expectParseFailure(`@preamble{"}"}
@article{real,title={Real}}
`, "malformed", /unexpected '}'|@preamble/i)
  })

  test("rejects a bare closing brace at the top level of a parenthesized preamble", () => {
    expectParseFailure(`@preamble(})
@article{real,title={Real}}
`, "malformed", /unexpected '}'|@preamble/i)
  })

  test("does not return partial entries when the invalid preamble sits between valid entries", () => {
    expectParseFailure(`@article{ok1, title={A}}
@preamble("}")
@article{ok2, title={B}}
`, "malformed", /unexpected '}'|@preamble/i)
  })

  test("keeps balanced braced literals valid inside either preamble form", () => {
    const quoted = parseBibtex(`@preamble("a {b} c")
@article{real,title={Real}}
`)
    expect(quoted.map((entry) => entry.key)).toEqual(["real"])

    const braced = parseBibtex(`@preamble({a {b} c})
@article{real,title={Real}}
`)
    expect(braced.map((entry) => entry.key)).toEqual(["real"])

    const nested = parseBibtex(`@preamble("a {b {c}} d")
@article{real,title={Real}}
`)
    expect(nested.map((entry) => entry.key)).toEqual(["real"])
  })

  test("keeps escaped closing braces valid inside preamble literals", () => {
    const entries = parseBibtex(`@preamble("a \\} b")
@article{real,title={Real}}
`)
    expect(entries.map((entry) => entry.key)).toEqual(["real"])
  })

  test("@comment remains deliberately opaque to unmatched closing braces", () => {
    const entries = parseBibtex(`@comment{"}"}
@article{real,title={Real}}
`)
    expect(entries.map((entry) => entry.key)).toEqual(["real"])
  })
})
