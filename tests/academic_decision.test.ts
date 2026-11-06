import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createRequire } from "node:module"
import { selectDshNativeTestGate } from "./dsh-native-test-gate"
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
    justification: "Fortalecer rigor metodológico da amostragem com base no capítulo 3.",
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

  describe("RED reproduction: Maintainer review PR #49 blockers (P1 & P2)", () => {
    test("P1 RED: formatAcademicDecisionQuestion must preserve evidence and justification in detail field", () => {
      const input: AcademicDecisionInput = {
        id: "q",
        prompt: "Escolha",
        evidence: "capitulo.tex:12",
        alternatives: [
          { label: "A", description: "Sem fundamento" },
          { label: "B", description: "Outra opção" },
        ],
        recommendation: {
          alternativeIndex: 0,
          justification: "Fundamento acadêmico X",
        },
      }
      const question = formatAcademicDecisionQuestion(input)
      expect((question as any).detail).toBeDefined()
      expect((question as any).detail).toContain("capitulo.tex:12")
      expect((question as any).detail).toContain("Fundamento acadêmico X")
    })

    test("P1 RED: formatAcademicDecisionQuestion must reject alternative marked isRecommendation without justification", () => {
      const input: AcademicDecisionInput = {
        id: "q2",
        prompt: "Escolha",
        evidence: "capitulo.tex:12",
        alternatives: [
          { label: "A", description: "Sem fundamento", isRecommendation: true },
          { label: "B", description: "Outra opção" },
        ],
      }
      expect(() => formatAcademicDecisionQuestion(input)).toThrow(AcademicDecisionError)
      try {
        formatAcademicDecisionQuestion(input)
      } catch (err: any) {
        expect(err.code).toBe("INVALID_RECOMMENDATION")
      }
    })

    test("P2 RED: processAcademicDecisionAnswer must reject multiple selections for single-select question", () => {
      const input: AcademicDecisionInput = {
        id: "q-single",
        prompt: "Pergunta single select?",
        evidence: sampleFinding.evidence,
        alternatives: [
          { label: "A", description: "Desc A" },
          { label: "B", description: "Desc B" },
        ],
      }
      const question = formatAcademicDecisionQuestion(input)
      const rawAnswer = {
        id: "q-single",
        selected: [question.options[0].label, question.options[1].label],
      }
      expect(() => processAcademicDecisionAnswer(input, question, rawAnswer)).toThrow(AcademicDecisionError)
      try {
        processAcademicDecisionAnswer(input, question, rawAnswer)
      } catch (err: any) {
        expect(err.code).toBe("INVALID_ANSWER")
      }
    })

    test("P2 RED: processAcademicDecisionAnswer must reject duplicate options in selection", () => {
      const input: AcademicDecisionInput = {
        id: "q-dup-sel",
        prompt: "Pergunta?",
        evidence: sampleFinding.evidence,
        alternatives: [
          { label: "A", description: "Desc A" },
          { label: "B", description: "Desc B" },
        ],
      }
      const question = formatAcademicDecisionQuestion(input)
      const rawAnswer = {
        id: "q-dup-sel",
        selected: [question.options[0].label, question.options[0].label],
      }
      expect(() => processAcademicDecisionAnswer(input, question, rawAnswer)).toThrow(AcademicDecisionError)
      try {
        processAcademicDecisionAnswer(input, question, rawAnswer)
      } catch (err: any) {
        expect(err.code).toBe("INVALID_ANSWER")
      }
    })

    test("P2 RED: processAcademicDecisionAnswer must reject combination of selected option and custom response", () => {
      const input: AcademicDecisionInput = {
        id: "q-comb",
        prompt: "Pergunta?",
        evidence: sampleFinding.evidence,
        alternatives: [
          { label: "A", description: "Desc A" },
          { label: "B", description: "Desc B" },
        ],
      }
      const question = formatAcademicDecisionQuestion(input)
      const rawAnswer = {
        id: "q-comb",
        selected: [question.options[0].label],
        custom: "Tentativa de resposta custom concorrente",
      }
      expect(() => processAcademicDecisionAnswer(input, question, rawAnswer)).toThrow(AcademicDecisionError)
      try {
        processAcademicDecisionAnswer(input, question, rawAnswer)
      } catch (err: any) {
        expect(err.code).toBe("INVALID_ANSWER")
      }
    })

    test("P2 RED: processAcademicDecisionAnswer must reject custom response when allowCustom is false", () => {
      const input: AcademicDecisionInput = {
        id: "q-no-custom",
        prompt: "Pergunta sem custom?",
        evidence: sampleFinding.evidence,
        alternatives: [
          { label: "A", description: "Desc A" },
          { label: "B", description: "Desc B" },
        ],
        allowCustom: false,
      }
      const question = formatAcademicDecisionQuestion(input)
      const rawAnswer = {
        id: "q-no-custom",
        selected: [],
        custom: "Resposta custom não autorizada",
      }
      expect(() => processAcademicDecisionAnswer(input, question, rawAnswer)).toThrow(AcademicDecisionError)
      try {
        processAcademicDecisionAnswer(input, question, rawAnswer)
      } catch (err: any) {
        expect(err.code).toBe("INVALID_ANSWER")
      }
    })

    test("P1-B RED: demonstrate loss of evidence and justification when question relies solely on detail field dropped by ask_user_question", () => {
      // In @deepseek-ai/dsh-tool-ask-user, the host tool parameter schema and execute()
      // only accept and forward: id, question, header, options, multi_select.
      // It does NOT expose or forward detail.
      const input: AcademicDecisionInput = {
        id: "q-detail-loss-proof",
        prompt: "Como conduzir o aprofundamento metodológico no capítulo 3?",
        evidence: "capitulos/metodologia.tex:45-60",
        findingId: "f-academic-001",
        alternatives: sampleAlternatives,
        recommendation: {
          alternativeIndex: 0,
          justification: "Recomendado para fortalecer rigor metodológico da dissertação.",
        },
      }
      const formatted = formatAcademicDecisionQuestion(input)

      // When the host tool ask_user_question maps the question to ctx.userQuestions.ask,
      // it takes formatted.question and drops formatted.detail:
      const forwardedToHostService = {
        id: formatted.id,
        question: formatted.question,
        header: formatted.header,
        options: formatted.options,
      }

      // RED assertion: the effective question forwarded to the user must contain the prompt,
      // the localized evidence, and the recommendation justification:
      expect(forwardedToHostService.question).toContain(input.prompt)
      expect(forwardedToHostService.question).toContain(input.evidence)
      expect(forwardedToHostService.question).toContain("Recomendado para fortalecer rigor metodológico da dissertação.")
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
      expect(question.question).toContain(input.prompt)
      expect(question.question).toContain(`Achado: ${sampleFinding.findingId}`)
      expect(question.question).toContain(`Evidência: ${sampleFinding.evidence}`)
      expect(question.question).toContain("Recomendado para fortalecer rigor metodológico da dissertação.")
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
            justification: "Fundamentação metodológica da proposta de revisão bibliográfica.",
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

  describe("Isolated tool contract: ask_user_question schema and answerer payload observation", () => {
    // Note: These tests verify the isolated contract and parameter schema of the installed
    // @deepseek-ai/dsh-tool-ask-user tool function within an isolated Context using synthetic
    // agent mocks. They do NOT prove end-to-end agent lifecycle execution (AgentRegistry,
    // Agent loop, SessionStore, etc.), which is validated separately via scripts/e2e-dsh-profile.ts
    // (reporting BLOCKED until authorized by maintainers).
    const nativeGate = selectDshNativeTestGate(process.env)
    const hostPackage = nativeGate.mode === "authorized" ? nativeGate.hostPackage : undefined
    const hostTest = hostPackage ? test : test.skip

    hostTest("1. Agent path executes native ask_user_question with questions conforming to banca-grille", async () => {
      const hostRequire = createRequire(hostPackage!)
      const { Context } = await import(hostRequire.resolve("@deepseek-ai/cordis"))
      const { default: SystemPrompt } = await import(hostRequire.resolve("@deepseek-ai/dsh-system-prompt"))
      const { default: ToolRuntime } = await import(hostRequire.resolve("@deepseek-ai/dsh-tools"))
      const { UserQuestionService } = await import(hostRequire.resolve("@deepseek-ai/dsh-user-questions"))
      const ToolAskUser = await import(hostRequire.resolve("@deepseek-ai/dsh-tool-ask-user"))

      const hostCtx = new Context()
      new SystemPrompt(hostCtx, {})
      new ToolRuntime(hostCtx)
      new UserQuestionService(hostCtx)
      ToolAskUser.apply(hostCtx)

      const localizedEvidence = `${sampleFinding.file}:${sampleFinding.startLine}-${sampleFinding.endLine} — ${sampleFinding.evidence}`
      const formattedQuestion = formatAcademicDecisionQuestion({
        id: "q-agent-path-001",
        prompt: "Como conduzir o aprofundamento metodológico no capítulo 3?",
        evidence: localizedEvidence,
        findingId: sampleFinding.findingId,
        alternatives: sampleAlternatives,
        recommendation: {
          alternativeIndex: 0,
          justification: "Recomendado para fortalecer rigor metodológico da dissertação.",
        },
      })

      // Wire a human answerer waterfall and observe the received payload
      let payloadReceivedByAnswerer: any = null
      hostCtx.on("user-questions/request", async (request: any) => {
        payloadReceivedByAnswerer = request
        expect(request.questions[0].id).toBe("q-agent-path-001")
        return {
          answers: [
            {
              id: request.questions[0].id,
              selected: [request.questions[0].options[0].label],
            },
          ],
        }
      })

      const askTool = hostCtx.tools.get("ask_user_question")
      expect(askTool).toBeDefined()

      const rootAgent = { id: "agent-root-test", session: { id: "sess-test" } }
      hostCtx.provide("agents", {
        get: (id: string) => (id === "agent-root-test" ? rootAgent : undefined),
        roots: () => [rootAgent],
        isOwnedBy: () => false,
      })

      const exec = {
        agent: rootAgent,
        signal: new AbortController().signal,
      }

      // Execute via the tool accessible to the model in the Agent loop
      const toolOutput = await askTool.execute(
        {
          questions: [
            {
              id: formattedQuestion.id,
              question: formattedQuestion.question,
              header: formattedQuestion.header,
              options: formattedQuestion.options,
            },
          ],
        },
        exec,
      )

      // Observe and prove the payload actually received by the human answerer waterfall:
      expect(payloadReceivedByAnswerer).toBeDefined()
      const answererQuestion = payloadReceivedByAnswerer.questions[0]
      expect(answererQuestion.id).toBe("q-agent-path-001")

      // 1. A pergunta acadêmica
      expect(answererQuestion.question).toContain("Como conduzir o aprofundamento metodológico no capítulo 3?")
      // 2. A evidência localizada
      expect(answererQuestion.question).toContain("capitulos/metodologia.tex:45-60")
      expect(answererQuestion.question).toContain("Achado: f-academic-001")
      // 3. A justificativa da recomendação
      expect(answererQuestion.question).toContain("Recomendado para fortalecer rigor metodológico da dissertação.")
      // Comprova que o campo detail NÃO foi transmitido pelo ask_user_question do host
      expect((answererQuestion as any).detail).toBeUndefined()

      // 4. As alternativas e consequências pertinentes
      expect(answererQuestion.options.length).toBe(4)
      expect(answererQuestion.options[0].label).toContain("(Recommended)")
      expect(answererQuestion.options[0].description).toContain("Consequência:")
      expect(answererQuestion.options[0].description).toContain("Riscos:")

      // 5. Os controles de incerteza e adiamento
      expect(answererQuestion.options[2].label).toBe(SAFE_OPTION_EVIDENCE)
      expect(answererQuestion.options[3].label).toBe(SAFE_OPTION_DEFER)

      // Assert tool output
      expect(toolOutput.answers).toBeDefined()
      expect(toolOutput.answers.length).toBe(1)
      expect(toolOutput.answers[0].selected).toContain(formattedQuestion.options[0].label)

      // Downstream interpretation preserves mutationAuthorized=false
      const result = processAcademicDecisionAnswer(
        {
          id: "q-agent-path-001",
          prompt: "Como conduzir o aprofundamento metodológico no capítulo 3?",
          evidence: localizedEvidence,
          alternatives: sampleAlternatives,
        },
        formattedQuestion,
        toolOutput.answers[0],
      )

      expect(result.mutationAuthorized).toBe(false)
      expect(result.outcome).toBe("selected_recommendation")
      expect(result.nextSteps).not.toContain("banca_corrigir")
    })

    hostTest("2. Host native ask_user_question directly blocks delegated subagents fail-closed (DELEGATED_CALLER)", async () => {
      const hostRequire = createRequire(hostPackage!)
      const { Context } = await import(hostRequire.resolve("@deepseek-ai/cordis"))
      const { default: SystemPrompt } = await import(hostRequire.resolve("@deepseek-ai/dsh-system-prompt"))
      const { default: ToolRuntime } = await import(hostRequire.resolve("@deepseek-ai/dsh-tools"))
      const { UserQuestionService } = await import(hostRequire.resolve("@deepseek-ai/dsh-user-questions"))
      const ToolAskUser = await import(hostRequire.resolve("@deepseek-ai/dsh-tool-ask-user"))

      const hostCtx = new Context()
      new SystemPrompt(hostCtx, {})
      new ToolRuntime(hostCtx)
      new UserQuestionService(hostCtx)
      ToolAskUser.apply(hostCtx)

      const rootAgent = { id: "agent-root", session: { id: "s-root" } }
      const subAgent = { id: "agent-sub", session: { id: "s-sub", header: { origin: "subagent" } } }

      hostCtx.provide("agents", {
        get: (id: string) => (id === "agent-sub" ? subAgent : rootAgent),
        roots: () => [rootAgent],
        isOwnedBy: (id: string, parent: any) => id === "agent-sub",
      })

      const askTool = hostCtx.tools.get("ask_user_question")
      expect(askTool).toBeDefined()

      let thrownErr: any = null
      try {
        await askTool.execute(
          {
            questions: [{ id: "q-sub-test", question: "Subagent asking human?" }],
          },
          { agent: subAgent, signal: new AbortController().signal },
        )
      } catch (err: any) {
        thrownErr = err
      }

      expect(thrownErr).toBeDefined()
      expect(thrownErr.code).toBe("DELEGATED_CALLER")
    })
  })
})
