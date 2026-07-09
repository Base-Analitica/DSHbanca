import { describe, test, expect } from "bun:test"
import { parseBibtex, bibEntryToRef } from "../src/lib/bibtex"

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
