import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  formatAcademicDecisionQuestion,
  processAcademicDecisionAnswer,
  runAcademicDecisionCycle,
  AcademicDecisionError,
  type AcademicAlternative,
  type AcademicDecisionInput,
  type AcademicDecisionResult,
  SAFE_OPTION_EVIDENCE,
  SAFE_OPTION_DEFER,
} from "../src/lib/academic_decision"

const sampleFinding = {
  findingId: "f-academic-001",
  file: "capitulos/metodologia.tex",
  startLine: 45,
  endLine: 60,
  evidence: "O capítulo 3 apresenta análise sem explicitar os critérios de amostragem utilizados.",
  category: "metodologia",
  severity: "importante",
}

const sampleAlternatives: AcademicAlternative[] = [
  {
    label: "Especificar amostragem probabilística estratificada",
    description: "Consequência: Define critérios estatísticos formais. Riscos: Exige dados adicionais. Fundamentação: Capítulo 3, linhas 45-60.",
    consequence: "Define critérios estatísticos formais.",
    risks: "Exige dados adicionais de estratificação.",
    evidence: "capitulos/metodologia.tex:45-60",
    isRecommendation: true,
  },
  {
    label: "Justificar amostragem por conveniência e explicitar limitações",
    description: "Consequência: Preserva os dados existentes sem nova coleta. Riscos: Menor generalização. Fundamentação: Seção 3.2.",
    consequence: "Preserva dados coletados.",
    risks: "Menor poder de generalização.",
    evidence: "capitulos/metodologia.tex:45-60",
  },
]

describe("Academic Decision Cycle (DSHbanca issue #48)", () => {
  describe("Skill banca-grille specification", () => {
    const skillPath = join(__dirname, "..", "skills", "banca-grille", "SKILL.md")
    const skillContent = readFileSync(skillPath, "utf8")

    test("banca-grille SKILL.md no longer restricts to pure textual interview", () => {
      expect(skillContent).not.toContain("atua exclusivamente através da comunicação textual")
      expect(skillContent).toContain("ask_user_question")
    })

    test("banca-grille SKILL.md defines structured alternatives and recommendation requirements", () => {
      expect(skillContent).toContain("alternativas")
      expect(skillContent).toContain("(Recommended)")
      expect(skillContent).toContain("Não sei")
      expect(skillContent).toContain("Adiar")
    })

    test("banca-grille SKILL.md enforces mandatory non-mutation safety rule", () => {
      expect(skillContent).toContain("NÃO autoriza corrigir")
    })
  })

  describe("Positive paths", () => {
    test("1. formats single structured question per decision with 2-4 alternatives", () => {
      const input: AcademicDecisionInput = {
        id: "q-decision-001",
        prompt: "Como deseja delimitar os critérios de amostragem na metodologia?",
        evidence: sampleFinding.evidence,
        findingId: sampleFinding.findingId,
        alternatives: sampleAlternatives,
        recommendation: {
          alternativeIndex: 0,
          justification: "Recomendado para fortalecer rigor metodológico da dissertação.",
        },
      }

      const question = formatAcademicDecisionQuestion(input)
      expect(question.id).toBe("q-decision-001")
      expect(question.question).toBe(input.prompt)
      expect(question.options.length).toBe(4) // 2 alternatives + Não sei + Adiar
      expect(question.options[0].label).toContain("(Recommended)")
      expect(question.options[0].description).toContain("Consequência:")
      expect(question.options[2].label).toBe(SAFE_OPTION_EVIDENCE)
      expect(question.options[3].label).toBe(SAFE_OPTION_DEFER)
    })

    test("2. selection without typing produces orientation and guarantees mutationAuthorized=false", () => {
      const input: AcademicDecisionInput = {
        id: "q-decision-002",
        prompt: "Como deseja delimitar os critérios de amostragem na metodologia?",
        evidence: sampleFinding.evidence,
        alternatives: sampleAlternatives,
        recommendation: { alternativeIndex: 0, justification: "Fundamentação sólida." },
      }
      const question = formatAcademicDecisionQuestion(input)

      const rawAnswer = {
        id: "q-decision-002",
        selected: [question.options[0].label],
      }

      const result = processAcademicDecisionAnswer(input, question, rawAnswer)
      expect(result.outcome).toBe("selected_recommendation")
      expect(result.mutationAuthorized).toBe(false)
      expect(result.selectedLabel).toBe(question.options[0].label)
      expect(result.orientation).toBeDefined()
      expect(result.nextSteps).toContain("investigar_evidencias")
      expect(result.nextSteps).not.toContain("banca_corrigir")
    })

    test("3. custom response (Outro) handled without mutation", () => {
      const input: AcademicDecisionInput = {
        id: "q-decision-003",
        prompt: "Como deseja delimitar os critérios de amostragem?",
        evidence: sampleFinding.evidence,
        alternatives: sampleAlternatives,
      }
      const question = formatAcademicDecisionQuestion(input)

      const rawAnswer = {
        id: "q-decision-003",
        selected: [],
        custom: "Manter abordagem mista com autorização expressa do comitê de ética",
      }

      const result = processAcademicDecisionAnswer(input, question, rawAnswer)
      expect(result.outcome).toBe("custom_response")
      expect(result.custom).toBe(rawAnswer.custom)
      expect(result.mutationAuthorized).toBe(false)
    })

    test("4. request more evidence (Não sei) handled safely", () => {
      const input: AcademicDecisionInput = {
        id: "q-decision-004",
        prompt: "Como deseja delimitar os critérios de amostragem?",
        evidence: sampleFinding.evidence,
        alternatives: sampleAlternatives,
      }
      const question = formatAcademicDecisionQuestion(input)

      const rawAnswer = {
        id: "q-decision-004",
        selected: [SAFE_OPTION_EVIDENCE],
      }

      const result = processAcademicDecisionAnswer(input, question, rawAnswer)
      expect(result.outcome).toBe("requested_evidence")
      expect(result.mutationAuthorized).toBe(false)
      expect(result.nextSteps).toContain("apresentar_trechos_e_evidencias")
    })

    test("5. safe deferral preserves pending state", () => {
      const input: AcademicDecisionInput = {
        id: "q-decision-005",
        prompt: "Como deseja delimitar os critérios de amostragem?",
        evidence: sampleFinding.evidence,
        alternatives: sampleAlternatives,
      }
      const question = formatAcademicDecisionQuestion(input)

      const rawAnswer = {
        id: "q-decision-005",
        selected: [SAFE_OPTION_DEFER],
      }

      const result = processAcademicDecisionAnswer(input, question, rawAnswer)
      expect(result.outcome).toBe("deferred")
      expect(result.mutationAuthorized).toBe(false)
      expect(result.nextSteps).toContain("preservar_pendencia_continuar_independentes")
    })

    test("6. full cycle execution with synthetic answerer and session association", async () => {
      const mockAgent = { id: "agent-root", session: { id: "sess-01" } }
      const mockCtx = {
        userQuestions: {
          ask: async ({ questions, agent }: any) => {
            expect(agent).toBe(mockAgent)
            return {
              answers: [
                {
                  id: questions[0].id,
                  selected: [questions[0].options[0].label],
                },
              ],
            }
          },
        },
      }

      const input: AcademicDecisionInput = {
        id: "q-decision-cycle-001",
        prompt: "Como tratar o finding F-01?",
        evidence: sampleFinding.evidence,
        alternatives: sampleAlternatives,
        recommendation: { alternativeIndex: 0, justification: "Melhor aderência." },
      }

      const result = await runAcademicDecisionCycle({
        ctx: mockCtx,
        agent: mockAgent,
        decisionInput: input,
      })

      expect(result.outcome).toBe("selected_recommendation")
      expect(result.mutationAuthorized).toBe(false)
    })
  })

  describe("Negative paths", () => {
    test("1. rejects when evidence is missing or empty", () => {
      const input: AcademicDecisionInput = {
        id: "q-neg-001",
        prompt: "Pergunta sem evidência?",
        evidence: "   ",
        alternatives: sampleAlternatives,
      }

      expect(() => formatAcademicDecisionQuestion(input)).toThrow(AcademicDecisionError)
      try {
        formatAcademicDecisionQuestion(input)
      } catch (err: any) {
        expect(err.code).toBe("NO_EVIDENCE")
      }
    })

    test("2. rejects when alternatives are fewer than 2", () => {
      const input: AcademicDecisionInput = {
        id: "q-neg-002",
        prompt: "Pergunta com 1 alternativa?",
        evidence: sampleFinding.evidence,
        alternatives: [sampleAlternatives[0]],
      }

      expect(() => formatAcademicDecisionQuestion(input)).toThrow(AcademicDecisionError)
      try {
        formatAcademicDecisionQuestion(input)
      } catch (err: any) {
        expect(err.code).toBe("INVALID_ALTERNATIVES")
      }
    })

    test("3. rejects when alternatives exceed 4", () => {
      const fiveAlternatives: AcademicAlternative[] = [
        ...sampleAlternatives,
        { label: "Alt 3", description: "Desc 3" },
        { label: "Alt 4", description: "Desc 4" },
        { label: "Alt 5", description: "Desc 5" },
      ]

      const input: AcademicDecisionInput = {
        id: "q-neg-003",
        prompt: "Pergunta com 5 alternativas?",
        evidence: sampleFinding.evidence,
        alternatives: fiveAlternatives,
      }

      expect(() => formatAcademicDecisionQuestion(input)).toThrow(AcademicDecisionError)
      try {
        formatAcademicDecisionQuestion(input)
      } catch (err: any) {
        expect(err.code).toBe("INVALID_ALTERNATIVES")
      }
    })

    test("4. rejects duplicate alternatives", () => {
      const duplicates: AcademicAlternative[] = [
        sampleAlternatives[0],
        sampleAlternatives[0],
      ]

      const input: AcademicDecisionInput = {
        id: "q-neg-004",
        prompt: "Pergunta com duplicata?",
        evidence: sampleFinding.evidence,
        alternatives: duplicates,
      }

      expect(() => formatAcademicDecisionQuestion(input)).toThrow(AcademicDecisionError)
      try {
        formatAcademicDecisionQuestion(input)
      } catch (err: any) {
        expect(err.code).toBe("INVALID_ALTERNATIVES")
      }
    })

    test("5. rejects duplicate question id in session", async () => {
      const mockAgent = { id: "agent-root", session: { id: "sess-01" } }
      const mockCtx = {
        userQuestions: {
          ask: async () => ({ answers: [{ id: "q-dup-1", selected: ["Opção"] }] }),
        },
      }
      const input: AcademicDecisionInput = {
        id: "q-dup-1",
        prompt: "Pergunta?",
        evidence: sampleFinding.evidence,
        alternatives: sampleAlternatives,
      }
      const seenIds = new Set<string>(["q-dup-1"])

      await expect(
        runAcademicDecisionCycle({
          ctx: mockCtx,
          agent: mockAgent,
          decisionInput: input,
          activeQuestionIds: seenIds,
        }),
      ).rejects.toThrow("DUPLICATE_QUESTION")
    })

    test("6. rejects mismatched question ID in answer", () => {
      const input: AcademicDecisionInput = {
        id: "q-original-id",
        prompt: "Pergunta?",
        evidence: sampleFinding.evidence,
        alternatives: sampleAlternatives,
      }
      const question = formatAcademicDecisionQuestion(input)
      const mismatchedAnswer = {
        id: "q-different-id",
        selected: [question.options[0].label],
      }

      expect(() =>
        processAcademicDecisionAnswer(input, question, mismatchedAnswer),
      ).toThrow("MISMATCHED_ID")
    })

    test("7. rejects answer containing option not in valid list and without custom", () => {
      const input: AcademicDecisionInput = {
        id: "q-valid-list",
        prompt: "Pergunta?",
        evidence: sampleFinding.evidence,
        alternatives: sampleAlternatives,
      }
      const question = formatAcademicDecisionQuestion(input)
      const invalidAnswer = {
        id: "q-valid-list",
        selected: ["Opção Inventada Fora do Catálogo"],
      }

      expect(() =>
        processAcademicDecisionAnswer(input, question, invalidAnswer),
      ).toThrow("INVALID_ANSWER")
    })

    test("8. rejects missing agent/session context", async () => {
      const mockCtx = { userQuestions: { ask: async () => ({ answers: [] }) } }
      const input: AcademicDecisionInput = {
        id: "q-no-agent",
        prompt: "Pergunta?",
        evidence: sampleFinding.evidence,
        alternatives: sampleAlternatives,
      }

      await expect(
        runAcademicDecisionCycle({
          ctx: mockCtx,
          agent: null as any,
          decisionInput: input,
        }),
      ).rejects.toThrow("INVALID_SESSION_CONTEXT")
    })

    test("9. blocks delegated caller agent with DELEGATED_CALLER error", async () => {
      const unverifiedAgent = {
        id: "agent-sub-01",
        session: { header: { origin: "subagent" } },
      }
      const parentAgent = { id: "agent-root" }
      const mockCtx = {
        agents: {
          get: (id: string) => (id === unverifiedAgent.id ? unverifiedAgent : null),
          isOwnedBy: (id: string, parent: any) => id === unverifiedAgent.id && parent === parentAgent,
          roots: () => [parentAgent],
        },
        userQuestions: {
          ask: async () => {
            throw new Error("Should not be called")
          },
        },
      }
      const input: AcademicDecisionInput = {
        id: "q-delegated-test",
        prompt: "Subagent asking?",
        evidence: sampleFinding.evidence,
        alternatives: sampleAlternatives,
      }

      await expect(
        runAcademicDecisionCycle({
          ctx: mockCtx,
          agent: unverifiedAgent,
          decisionInput: input,
          parentAgent,
        }),
      ).rejects.toThrow("DELEGATED_CALLER")
    })

    test("10. handles cancellation signal cleanly (ASK_ABORTED)", async () => {
      const mockAgent = { id: "agent-root", session: { id: "sess-01" } }
      const abortCtrl = new AbortController()
      abortCtrl.abort()

      const mockCtx = {
        userQuestions: {
          ask: async ({ signal }: any) => {
            if (signal?.aborted) {
              const err: any = new Error("Ask aborted")
              err.code = "ASK_ABORTED"
              throw err
            }
            return { answers: [] }
          },
        },
      }
      const input: AcademicDecisionInput = {
        id: "q-abort-test",
        prompt: "Pergunta abortada?",
        evidence: sampleFinding.evidence,
        alternatives: sampleAlternatives,
      }

      await expect(
        runAcademicDecisionCycle({
          ctx: mockCtx,
          agent: mockAgent,
          decisionInput: input,
          signal: abortCtrl.signal,
        }),
      ).rejects.toThrow("ASK_ABORTED")
    })

    test("11. handles service unavailability fail-closed (SERVICE_UNAVAILABLE)", async () => {
      const mockAgent = { id: "agent-root", session: { id: "sess-01" } }
      const mockCtxWithoutService = {} // no userQuestions
      const input: AcademicDecisionInput = {
        id: "q-unavailable",
        prompt: "Pergunta?",
        evidence: sampleFinding.evidence,
        alternatives: sampleAlternatives,
      }

      await expect(
        runAcademicDecisionCycle({
          ctx: mockCtxWithoutService,
          agent: mockAgent,
          decisionInput: input,
        }),
      ).rejects.toThrow("SERVICE_UNAVAILABLE")
    })

    test("12. handles absence of answerer fail-closed (NO_PROVIDER)", async () => {
      const mockAgent = { id: "agent-root", session: { id: "sess-01" } }
      const mockCtx = {
        userQuestions: {
          ask: async () => {
            const err: any = new Error("No provider available")
            err.code = "NO_PROVIDER"
            throw err
          },
        },
      }
      const input: AcademicDecisionInput = {
        id: "q-no-prov",
        prompt: "Pergunta?",
        evidence: sampleFinding.evidence,
        alternatives: sampleAlternatives,
      }

      await expect(
        runAcademicDecisionCycle({
          ctx: mockCtx,
          agent: mockAgent,
          decisionInput: input,
        }),
      ).rejects.toThrow("NO_PROVIDER")
    })

    test("13. guarantees selection never authorizes mutation nor executes banca_corrigir/banca_restore", () => {
      const input: AcademicDecisionInput = {
        id: "q-safety-test",
        prompt: "Revisar a referência e propor a correção?",
        evidence: sampleFinding.evidence,
        alternatives: [
          {
            label: "Revisar a referência e propor a correção",
            description: "Investigar a referência e preparar proposta examinável.",
            isRecommendation: true,
          },
          {
            label: "Manter texto atual",
            description: "Preservar redação original.",
          },
        ],
      }
      const question = formatAcademicDecisionQuestion(input)
      const rawAnswer = {
        id: "q-safety-test",
        selected: [question.options[0].label],
      }
      const result = processAcademicDecisionAnswer(input, question, rawAnswer)

      expect(result.mutationAuthorized).toBe(false)
      expect((result as any).allowedOnce).toBeUndefined()
      expect(result.nextSteps).not.toContain("banca_corrigir")
      expect(result.nextSteps).not.toContain("banca_restore")
    })

    test("14. teardown guarantees resources are cleaned up upon failure", async () => {
      let cleanedUp = false
      const mockAgent = { id: "agent-root", session: { id: "sess-01" } }
      const mockCtx = {
        userQuestions: {
          ask: async () => {
            throw new Error("Simulated failure in ask")
          },
        },
      }
      const input: AcademicDecisionInput = {
        id: "q-teardown-test",
        prompt: "Pergunta?",
        evidence: sampleFinding.evidence,
        alternatives: sampleAlternatives,
      }

      try {
        await runAcademicDecisionCycle({
          ctx: mockCtx,
          agent: mockAgent,
          decisionInput: input,
          onTeardown: () => {
            cleanedUp = true
          },
        })
      } catch {
        // Expected
      }

      expect(cleanedUp).toBe(true)
    })
  })
})
