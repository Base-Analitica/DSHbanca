import { describe, test, expect } from "bun:test"
import { crossrefToRef } from "../src/lib/academic"

describe("crossrefToRef", () => {
  test("transforms Crossref API item to RefMetadata", () => {
    const item = {
      title: ["Test Paper Title"],
      author: [{ given: "John", family: "Doe" }, { given: "Jane", family: "Smith" }],
      DOI: "10.1000/xyz789",
      "container-title": ["Journal of Tests"],
      published: { "date-parts": [[2023, 5, 1]] },
    }

    const ref = crossrefToRef(item, "doe2023")
    expect(ref.key).toBe("doe2023")
    expect(ref.title).toBe("Test Paper Title")
    expect(ref.authors).toEqual(["John Doe", "Jane Smith"])
    expect(ref.doi).toBe("10.1000/xyz789")
    expect(ref.journal).toBe("Journal of Tests")
    expect(ref.year).toBe(2023)
  })

  test("handles missing fields", () => {
    const ref = crossrefToRef({}, "empty2023")
    expect(ref.key).toBe("empty2023")
    expect(ref.title).toBeUndefined()
    expect(ref.authors).toBeUndefined()
    expect(ref.year).toBeUndefined()
  })
})
