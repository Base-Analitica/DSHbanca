import { describe, expect, test } from "bun:test"
import {
  classifyNativeQuestionsStatus,
  classifyProfileGateStatuses,
  validateNativeQuestionsEvidence,
  type NativeQuestionsEvidence,
} from "../scripts/lib/dsh-profile-e2e-contract.js"

export const completeNativeQuestionsEvidence: NativeQuestionsEvidence = {
  hostApiAvailable: true,
  userQuestionsServiceAvailable: true,
  approvalServiceAvailable: true,
  syntheticScenarioCompleted: true,
  behaviors: {
    selectRecommendation: {
      questionId: "q-academic-rec-1",
      prompt: "Como deseja tratar a fundamentação teórica insuficiente apontada na auditoria?",
      validOptions: [
        "Adotar recomendação: Adicionar seção de Trabalhos Relacionados",
        "Não sei — explique/mostre evidências",
        "Adiar / continuar outras etapas",
      ],
      observedAnswer: {
        id: "q-academic-rec-1",
        selected: ["Adotar recomendação: Adicionar seção de Trabalhos Relacionados"],
      },
      isRecommendation: true,
      mutationAuthorized: false,
    },
    requestMoreEvidence: {
      questionId: "q-academic-evid-1",
      prompt: "Deseja ver as evidências da omissão bibliográfica?",
      validOptions: [
        "Adotar recomendação: Incluir citações indicadas",
        "Não sei — explique/mostre evidências",
        "Adiar / continuar outras etapas",
      ],
      observedAnswer: {
        id: "q-academic-evid-1",
        selected: ["Não sei — explique/mostre evidências"],
      },
      mutationAuthorized: false,
    },
    deferDecision: {
      questionId: "q-academic-defer-1",
      prompt: "Deseja deliberar agora sobre a reestruturação da introdução?",
      validOptions: [
        "Adotar recomendação: Reescrever parágrafos 2 e 3",
        "Adiar / continuar outras etapas",
      ],
      observedAnswer: {
        id: "q-academic-defer-1",
        selected: ["Adiar / continuar outras etapas"],
      },
      mutationAuthorized: false,
    },
    customResponse: {
      questionId: "q-academic-custom-1",
      prompt: "Qual direcionamento metodológico adotar no capítulo 3?",
      validOptions: [
        "Adotar recomendação: Análise quantitativa",
        "Adiar / continuar outras etapas",
      ],
      observedAnswer: {
        id: "q-academic-custom-1",
        selected: [],
        custom: "Outro: Manter escopo atual conforme deliberação do orientador",
      },
      mutationAuthorized: false,
    },
    cancelQuestion: {
      questionId: "q-academic-cancel-1",
      prompt: "Pergunta que será cancelada imediatamente?",
      cancelled: true,
      errorCode: "ASK_ABORTED",
    },
    rejectIncompatibleAnswer: {
      rejected: true,
      errorCode: "BAD_INTENT",
    },
    delegatedAgentBlocked: {
      callingAgentOrigin: "subagent",
      isOwnedByParent: true,
      notInRoots: true,
      blocked: true,
      errorCode: "DELEGATED_CALLER",
      answererReached: false,
    },
    selectionDoesNotAuthorizeMutation: {
      nonMutatingProof: true,
      sessionAuditAvailable: true,
      sessionEventsRead: 12,
      approvalEventsCount: 0,
      noApprovalEmitted: true,
      mutationDispatched: false,
      manuscriptPreserved: true,
      auditorGuardUsedAsProof: false,
    },
  },
  independentApproval: {
    status: "BLOCKED",
    openTurnRequiredObserved: true,
    openTurnErrorMessage:
      "approval.request() outside an open turn: the approval/asked + approval/decided audit pair must be turn-enclosed (a bare event between turns is crash-tail garbage on reload). Ask from inside the turn that needs the decision.",
    interactiveDecisionsStatus: "BLOCKED",
    interactiveDecisionsBlocker:
      "Interactive approval decisions require an open turn, pending separately authorized lifecycle execution.",
  },
  uiWebDisclaimer:
    "Synthetic answerer for native DSH contract verification only; not proof of real Web UI or interactive browser session.",
  modelExecutionUsed: false,
}

export const fullPassNativeQuestionsEvidence: NativeQuestionsEvidence = {
  ...completeNativeQuestionsEvidence,
  independentApproval: {
    status: "PASS",
    openTurnRequiredObserved: true,
    openTurnErrorMessage:
      "approval.request() outside an open turn: the approval/asked + approval/decided audit pair must be turn-enclosed (a bare event between turns is crash-tail garbage on reload). Ask from inside the turn that needs the decision.",
    interactiveDecisionsStatus: "PASS",
    turnIntegrity: {
      singleTurnClosed: true,
      turnStartSeq: 1,
      turnEndSeq: 10,
    },
    unavailableProvedByAbsenceOfProvider: true,
    observedDecisions: [
      {
        requestId: "appr-req-001",
        agentId: "agent-root-test",
        sessionId: "sess-turn-001",
        toolName: "academic_approval_allowed_action",
        askedSeq: 2,
        decidedSeq: 3,
        turnSeq: 2,
        outcome: "allowed-once",
        auditEvents: {
          askedEventLogged: true,
          decidedEventLogged: true,
        },
        turnBoundaries: {
          turnStartSeq: 1,
          turnEndSeq: 10,
          isEnclosed: true,
        },
      },
      {
        requestId: "appr-req-002",
        agentId: "agent-root-test",
        sessionId: "sess-turn-001",
        toolName: "academic_approval_rejected_action",
        askedSeq: 4,
        decidedSeq: 5,
        turnSeq: 4,
        outcome: "rejected",
        auditEvents: {
          askedEventLogged: true,
          decidedEventLogged: true,
        },
        turnBoundaries: {
          turnStartSeq: 1,
          turnEndSeq: 10,
          isEnclosed: true,
        },
      },
      {
        requestId: "appr-req-003",
        agentId: "agent-root-test",
        sessionId: "sess-turn-001",
        toolName: "academic_approval_cancelled_action",
        askedSeq: 6,
        decidedSeq: 7,
        turnSeq: 6,
        outcome: "cancelled",
        auditEvents: {
          askedEventLogged: true,
          decidedEventLogged: true,
        },
        turnBoundaries: {
          turnStartSeq: 1,
          turnEndSeq: 10,
          isEnclosed: true,
        },
      },
      {
        requestId: "appr-req-004",
        agentId: "agent-root-test",
        sessionId: "sess-turn-001",
        toolName: "academic_approval_unavailable_action",
        askedSeq: 8,
        decidedSeq: 9,
        turnSeq: 8,
        outcome: "unavailable",
        auditEvents: {
          askedEventLogged: true,
          decidedEventLogged: true,
        },
        turnBoundaries: {
          turnStartSeq: 1,
          turnEndSeq: 10,
          isEnclosed: true,
        },
        unansweredByProvider: true,
      },
    ],
    allowedOnceIsSoleGrant: true,
    nonGrantsDeny: {
      rejectedDenies: true,
      cancelledDenies: true,
      unavailableDenies: true,
    },
  },
}

describe("DSH native questions and independent approval contract (#46)", () => {
  describe("P1 reproduction: eliminate false PASS on forged evidence", () => {
    test("rejects the forged evidence from formal review that previously yielded false PASS", () => {
      const forged = {
        hostApiAvailable: true,
        userQuestionsServiceAvailable: true,
        approvalServiceAvailable: true,
        syntheticScenarioCompleted: true,
        behaviors: {
          selectionDoesNotAuthorizeMutation: {
            manuscriptPreserved: true,
            sessionAuditAvailable: false,
          },
          cancelQuestion: { cancelled: true, errorCode: "ASK_ABORTED" },
          delegatedAgentBlocked: { blocked: true, errorCode: "DELEGATED_CALLER" },
          rejectIncompatibleAnswer: { rejected: true },
        },
        independentApproval: {
          contractVerified: true,
          allowedOnceIsSoleGrant: true,
          nonGrantsDeny: {
            rejectedDenies: true,
            cancelledDenies: true,
            unavailableDenies: true,
          },
          requiresOpenTurn: true,
        },
        uiWebDisclaimer: "synthetic only",
        modelExecutionUsed: false,
      }

      const errors = validateNativeQuestionsEvidence(forged)
      expect(errors.length).toBeGreaterThan(0)
      expect(errors).toContain("selectRecommendation behavior is required and missing")
      expect(errors).toContain("requestMoreEvidence behavior is required and missing")
      expect(errors).toContain("deferDecision behavior is required and missing")
      expect(errors).toContain("customResponse behavior is required and missing")
      expect(errors).toContain("session event stream was not available or could not be verified to prove absence of approval")
      expect(errors).toContain("unobserved static boolean claim of approval contract verification is rejected")
      expect(classifyNativeQuestionsStatus(forged)).toBe("FAIL")
    })

    test("P1 residual RED: rejects approval.status=PASS when based purely on static booleans without observed native decisions", () => {
      const staticPass = {
        ...completeNativeQuestionsEvidence,
        independentApproval: {
          status: "PASS" as const,
          openTurnRequiredObserved: true,
          openTurnErrorMessage:
            "approval.request() outside an open turn: the approval/asked + approval/decided audit pair must be turn-enclosed (a bare event between turns is crash-tail garbage on reload). Ask from inside the turn that needs the decision.",
          interactiveDecisionsStatus: "PASS" as const,
          allowedOnceIsSoleGrant: true,
          nonGrantsDeny: {
            rejectedDenies: true,
            cancelledDenies: true,
            unavailableDenies: true,
          },
        },
      }
      const errors = validateNativeQuestionsEvidence(staticPass)
      expect(errors).toContain(
        "approval.status cannot be PASS without verified native observedDecisions containing turn-enclosed audit events",
      )
      expect(classifyNativeQuestionsStatus(staticPass)).toBe("FAIL")
    })
  })

  describe("P1 Required regressions", () => {
    // 1. Evidência sem seleção de recomendação
    test("regression 1: rejects evidence missing selectRecommendation", () => {
      const { selectRecommendation: _, ...remainingBehaviors } = completeNativeQuestionsEvidence.behaviors
      const invalid = {
        ...completeNativeQuestionsEvidence,
        behaviors: remainingBehaviors as any,
      }
      const errors = validateNativeQuestionsEvidence(invalid)
      expect(errors).toContain("selectRecommendation behavior is required and missing")
      expect(classifyNativeQuestionsStatus(invalid)).toBe("FAIL")
    })

    // 2. Evidência sem solicitação de informações adicionais
    test("regression 2: rejects evidence missing requestMoreEvidence", () => {
      const { requestMoreEvidence: _, ...remainingBehaviors } = completeNativeQuestionsEvidence.behaviors
      const invalid = {
        ...completeNativeQuestionsEvidence,
        behaviors: remainingBehaviors as any,
      }
      const errors = validateNativeQuestionsEvidence(invalid)
      expect(errors).toContain("requestMoreEvidence behavior is required and missing")
      expect(classifyNativeQuestionsStatus(invalid)).toBe("FAIL")
    })

    // 3. Evidência sem adiamento observado
    test("regression 3: rejects evidence missing deferDecision", () => {
      const { deferDecision: _, ...remainingBehaviors } = completeNativeQuestionsEvidence.behaviors
      const invalid = {
        ...completeNativeQuestionsEvidence,
        behaviors: remainingBehaviors as any,
      }
      const errors = validateNativeQuestionsEvidence(invalid)
      expect(errors).toContain("deferDecision behavior is required and missing")
      expect(classifyNativeQuestionsStatus(invalid)).toBe("FAIL")
    })

    // 4. Evidência sem resposta personalizada
    test("regression 4: rejects evidence missing customResponse", () => {
      const { customResponse: _, ...remainingBehaviors } = completeNativeQuestionsEvidence.behaviors
      const invalid = {
        ...completeNativeQuestionsEvidence,
        behaviors: remainingBehaviors as any,
      }
      const errors = validateNativeQuestionsEvidence(invalid)
      expect(errors).toContain("customResponse behavior is required and missing")
      expect(classifyNativeQuestionsStatus(invalid)).toBe("FAIL")
    })

    // 5. Resposta com ID desconhecido
    test("regression 5: rejects observed answer with mismatched question ID", () => {
      const invalid = {
        ...completeNativeQuestionsEvidence,
        behaviors: {
          ...completeNativeQuestionsEvidence.behaviors,
          selectRecommendation: {
            ...completeNativeQuestionsEvidence.behaviors.selectRecommendation,
            observedAnswer: {
              id: "wrong-unknown-id",
              selected: ["Adotar recomendação: Adicionar seção de Trabalhos Relacionados"],
            },
          },
        },
      }
      const errors = validateNativeQuestionsEvidence(invalid)
      expect(errors).toContain("observed answer id does not match requested question id")
      expect(classifyNativeQuestionsStatus(invalid)).toBe("FAIL")
    })

    // 6. Resposta incompatível com as opções oferecidas
    test("regression 6: rejects observed answer containing option not in validOptions", () => {
      const invalid = {
        ...completeNativeQuestionsEvidence,
        behaviors: {
          ...completeNativeQuestionsEvidence.behaviors,
          selectRecommendation: {
            ...completeNativeQuestionsEvidence.behaviors.selectRecommendation,
            observedAnswer: {
              id: "q-academic-rec-1",
              selected: ["Opção Incompatível Fora do Catálogo"],
            },
          },
        },
      }
      const errors = validateNativeQuestionsEvidence(invalid)
      expect(errors).toContain("observed answer selected option is not in valid options list")
      expect(classifyNativeQuestionsStatus(invalid)).toBe("FAIL")
    })

    // 7. Serviço de aprovação que lança erro genérico
    test("regression 7: rejects generic exception from approval service instead of open turn error", () => {
      const invalid = {
        ...completeNativeQuestionsEvidence,
        independentApproval: {
          ...completeNativeQuestionsEvidence.independentApproval,
          openTurnRequiredObserved: true,
          openTurnErrorMessage: "Error: generic approval internal failure",
        },
      }
      const errors = validateNativeQuestionsEvidence(invalid)
      expect(errors).toContain("approval service threw generic error instead of open turn precondition error")
      expect(classifyNativeQuestionsStatus(invalid)).toBe("FAIL")
    })

    // 8. Serviço de perguntas que lança erro genérico
    test("regression 8: rejects generic error from userQuestions instead of BAD_ANSWER/BAD_INTENT", () => {
      const invalid = {
        ...completeNativeQuestionsEvidence,
        behaviors: {
          ...completeNativeQuestionsEvidence.behaviors,
          rejectIncompatibleAnswer: {
            rejected: true,
            errorCode: "GENERIC_ERROR",
          },
        },
      }
      const errors = validateNativeQuestionsEvidence(invalid)
      expect(errors).toContain("incompatible answer error code must be BAD_ANSWER or BAD_INTENT")
      expect(classifyNativeQuestionsStatus(invalid)).toBe("FAIL")
    })

    // 9. Evidência com contractVerified=true, mas sem comprovação nativa
    test("regression 9: rejects unobserved static boolean claim of contractVerified=true", () => {
      const invalid = {
        ...completeNativeQuestionsEvidence,
        independentApproval: {
          ...completeNativeQuestionsEvidence.independentApproval,
          contractVerified: true,
        },
      }
      const errors = validateNativeQuestionsEvidence(invalid)
      expect(errors).toContain("unobserved static boolean claim of approval contract verification is rejected")
      expect(classifyNativeQuestionsStatus(invalid)).toBe("FAIL")
    })

    // 10. Tentativa de apresentar negativa do auditor como prova de aprovação independente
    test("regression 10: rejects presenting auditor read-only guard as proof of independent approval", () => {
      const invalid = {
        ...completeNativeQuestionsEvidence,
        behaviors: {
          ...completeNativeQuestionsEvidence.behaviors,
          selectionDoesNotAuthorizeMutation: {
            ...completeNativeQuestionsEvidence.behaviors.selectionDoesNotAuthorizeMutation,
            attemptedTool: "banca_corrigir",
            auditorGuardUsedAsProof: true,
          },
        },
      }
      const errors = validateNativeQuestionsEvidence(invalid)
      expect(errors).toContain("auditor read-only guard must not be presented as proof of independent approval boundary")
      expect(classifyNativeQuestionsStatus(invalid)).toBe("FAIL")
    })

    // 11. Ausência de answerer
    test("regression 11: confirms absence of answerer fails with NO_PROVIDER and is not accepted as answered", () => {
      const invalid = {
        ...completeNativeQuestionsEvidence,
        behaviors: {
          ...completeNativeQuestionsEvidence.behaviors,
          selectRecommendation: {
            ...completeNativeQuestionsEvidence.behaviors.selectRecommendation,
            observedAnswer: {
              id: "q-academic-rec-1",
              selected: [],
            },
          },
        },
      }
      const errors = validateNativeQuestionsEvidence(invalid)
      expect(errors).toContain("selectRecommendation observedAnswer must have non-empty selected array")
      expect(classifyNativeQuestionsStatus(invalid)).toBe("FAIL")
    })

    // 12. Relatório sintético incompleto que anteriormente retornava PASS
    test("regression 12: incomplete synthetic report must FAIL, never PASS", () => {
      const incomplete = {
        hostApiAvailable: true,
        userQuestionsServiceAvailable: true,
        approvalServiceAvailable: true,
        syntheticScenarioCompleted: true,
        behaviors: {
          selectRecommendation: completeNativeQuestionsEvidence.behaviors.selectRecommendation,
        },
        independentApproval: completeNativeQuestionsEvidence.independentApproval,
        uiWebDisclaimer: "synthetic",
        modelExecutionUsed: false,
      }
      const errors = validateNativeQuestionsEvidence(incomplete)
      expect(errors.length).toBeGreaterThan(0)
      expect(classifyNativeQuestionsStatus(incomplete)).toBe("FAIL")
    })

    // P1 Problem 2: Telemetria ausente / sessionAuditAvailable
    test("regression: rejects when sessionAuditAvailable is false (session or seq unavailable)", () => {
      const invalid = {
        ...completeNativeQuestionsEvidence,
        behaviors: {
          ...completeNativeQuestionsEvidence.behaviors,
          selectionDoesNotAuthorizeMutation: {
            ...completeNativeQuestionsEvidence.behaviors.selectionDoesNotAuthorizeMutation,
            sessionAuditAvailable: false,
            noApprovalEmitted: false,
          },
        },
      }
      const errors = validateNativeQuestionsEvidence(invalid)
      expect(errors).toContain(
        "session event stream was not available or could not be verified to prove absence of approval",
      )
      expect(classifyNativeQuestionsStatus(invalid)).toBe("FAIL")
    })

    test("regression: rejects when sessionEventsRead is missing or negative", () => {
      const invalid = {
        ...completeNativeQuestionsEvidence,
        behaviors: {
          ...completeNativeQuestionsEvidence.behaviors,
          selectionDoesNotAuthorizeMutation: {
            ...completeNativeQuestionsEvidence.behaviors.selectionDoesNotAuthorizeMutation,
            sessionEventsRead: -1,
          },
        },
      }
      const errors = validateNativeQuestionsEvidence(invalid)
      expect(errors).toContain(
        "sessionEventsRead must be a non-negative number proving session events were inspected",
      )
      expect(classifyNativeQuestionsStatus(invalid)).toBe("FAIL")
    })

    test("regression: rejects when approval events were found in session log", () => {
      const invalid = {
        ...completeNativeQuestionsEvidence,
        behaviors: {
          ...completeNativeQuestionsEvidence.behaviors,
          selectionDoesNotAuthorizeMutation: {
            ...completeNativeQuestionsEvidence.behaviors.selectionDoesNotAuthorizeMutation,
            approvalEventsCount: 1,
            noApprovalEmitted: false,
          },
        },
      }
      const errors = validateNativeQuestionsEvidence(invalid)
      expect(errors).toContain(
        "approval events were detected in session log following question workflow",
      )
      expect(classifyNativeQuestionsStatus(invalid)).toBe("FAIL")
    })

    // P1 Delegated Agent regressions
    test("P1 RED reproduction: rejects when delegatedAgentBlocked returns NO_PROVIDER instead of DELEGATED_CALLER", () => {
      const invalid = {
        ...completeNativeQuestionsEvidence,
        behaviors: {
          ...completeNativeQuestionsEvidence.behaviors,
          delegatedAgentBlocked: {
            callingAgentOrigin: "subagent",
            isOwnedByParent: false,
            notInRoots: false,
            blocked: false,
            errorCode: "NO_PROVIDER",
            answererReached: true,
          },
        },
      }
      const errors = validateNativeQuestionsEvidence(invalid)
      expect(errors).toContain("NO_PROVIDER must not be accepted as proof of delegated agent blocking")
      expect(errors).toContain("delegated agent must be verified as owned by parent in runtime")
      expect(errors).toContain("delegated agent must not be present in runtime roots")
      expect(errors).toContain("delegated agent question must not reach the answerer")
      expect(errors).toContain("delegated agent must be blocked from userQuestions with DELEGATED_CALLER")
      expect(classifyNativeQuestionsStatus(invalid)).toBe("FAIL")
    })

    test("regression: rejects when delegated agent is not owned by parent in runtime", () => {
      const invalid = {
        ...completeNativeQuestionsEvidence,
        behaviors: {
          ...completeNativeQuestionsEvidence.behaviors,
          delegatedAgentBlocked: {
            ...completeNativeQuestionsEvidence.behaviors.delegatedAgentBlocked,
            isOwnedByParent: false,
          },
        },
      }
      const errors = validateNativeQuestionsEvidence(invalid)
      expect(errors).toContain("delegated agent must be verified as owned by parent in runtime")
      expect(classifyNativeQuestionsStatus(invalid)).toBe("FAIL")
    })

    test("regression: rejects when delegated agent is present in runtime roots", () => {
      const invalid = {
        ...completeNativeQuestionsEvidence,
        behaviors: {
          ...completeNativeQuestionsEvidence.behaviors,
          delegatedAgentBlocked: {
            ...completeNativeQuestionsEvidence.behaviors.delegatedAgentBlocked,
            notInRoots: false,
          },
        },
      }
      const errors = validateNativeQuestionsEvidence(invalid)
      expect(errors).toContain("delegated agent must not be present in runtime roots")
      expect(classifyNativeQuestionsStatus(invalid)).toBe("FAIL")
    })

    test("regression: rejects when delegated agent question reached the answerer", () => {
      const invalid = {
        ...completeNativeQuestionsEvidence,
        behaviors: {
          ...completeNativeQuestionsEvidence.behaviors,
          delegatedAgentBlocked: {
            ...completeNativeQuestionsEvidence.behaviors.delegatedAgentBlocked,
            answererReached: true,
          },
        },
      }
      const errors = validateNativeQuestionsEvidence(invalid)
      expect(errors).toContain("delegated agent question must not reach the answerer")
      expect(classifyNativeQuestionsStatus(invalid)).toBe("FAIL")
    })
  })

  describe("Caller identity differentiation on ctx.userQuestions (DSH contract)", () => {
    // Exact simulation of DSH AgentRegistry and UserQuestions assertLiveRoot
    interface AgentStub {
      id: string
      session: { id: string; header: { origin?: string; parentSession?: string } }
    }

    class FakeDshAgentRegistry {
      private store = new Map<string, { agent: AgentStub; owner?: AgentStub }>()

      enter(agent: AgentStub, owner?: AgentStub) {
        this.store.set(agent.id, { agent, owner })
      }

      get(id: string) {
        return this.store.get(id)?.agent
      }

      isOwnedBy(id: string, owner: AgentStub) {
        return this.store.get(id)?.owner === owner
      }

      roots() {
        return [...this.store.values()].filter((e) => e.owner === undefined).map((e) => e.agent)
      }

      dispose(id: string) {
        this.store.delete(id)
      }
    }

    class FakeDshUserQuestions {
      constructor(
        private agents: FakeDshAgentRegistry,
        private answerer?: (req: any) => Promise<any>,
      ) {}

      assertLiveRoot(agent: AgentStub) {
        if (this.agents.get(agent.id) !== agent) {
          const err = new Error("human interaction requires the exact live calling agent when an agent is supplied") as any
          err.code = "CALLER_NOT_LIVE"
          throw err
        }
        if (!this.agents.roots().includes(agent)) {
          const err = new Error("human interaction is unavailable while the calling agent is owned by another live agent; include the unresolved question or decision in the child agent's final result") as any
          err.code = "DELEGATED_CALLER"
          throw err
        }
      }

      async ask(request: { questions: any[]; agent?: AgentStub }) {
        if (request.agent !== undefined) {
          this.assertLiveRoot(request.agent)
        }
        if (!this.answerer) {
          const err = new Error("user question service has no active answering provider") as any
          err.code = "NO_PROVIDER"
          throw err
        }
        return this.answerer(request)
      }
    }

    test("Case 1: Valid root agent with answerer succeeds", async () => {
      const registry = new FakeDshAgentRegistry()
      const rootAgent: AgentStub = { id: "root-1", session: { id: "root-1", header: { origin: "root" } } }
      registry.enter(rootAgent, undefined) // root: owner is undefined

      expect(registry.roots()).toContain(rootAgent)
      expect(registry.get("root-1")).toBe(rootAgent)

      let answererCalled = false
      const questions = new FakeDshUserQuestions(registry, async () => {
        answererCalled = true
        return { answers: [{ id: "q1", selected: ["Option A"] }] }
      })

      const res = await questions.ask({ questions: [{ id: "q1" }], agent: rootAgent })
      expect(res.answers[0].selected).toEqual(["Option A"])
      expect(answererCalled).toBe(true)
    })

    test("Case 2: Agent with subagent metadata but NO runtime owner is in roots and fails with NO_PROVIDER, not DELEGATED_CALLER", async () => {
      const registry = new FakeDshAgentRegistry()
      const parentAgent: AgentStub = { id: "parent-1", session: { id: "parent-1", header: {} } }
      registry.enter(parentAgent, undefined)

      // Subagent metadata in session, but created WITHOUT parentAgent (runtime owner = undefined)
      const fakeSubagent: AgentStub = {
        id: "subagent-no-owner",
        session: { id: "subagent-no-owner", header: { origin: "subagent", parentSession: "parent-1" } },
      }
      registry.enter(fakeSubagent, undefined) // BUG: owner was not passed!

      // Registry sees it as ROOT because owner is undefined!
      expect(registry.roots()).toContain(fakeSubagent)
      expect(registry.isOwnedBy(fakeSubagent.id, parentAgent)).toBe(false)

      let answererCalled = false
      const questions = new FakeDshUserQuestions(registry, undefined) // no answerer

      // assertLiveRoot passes because it is in roots, then fails with NO_PROVIDER instead of DELEGATED_CALLER!
      await expect(questions.ask({ questions: [{ id: "q1" }], agent: fakeSubagent })).rejects.toMatchObject({
        code: "NO_PROVIDER",
      })
      expect(answererCalled).toBe(false)
    })

    test("Case 3: Child agent with real runtime owner throws DELEGATED_CALLER and question NEVER reaches answerer", async () => {
      const registry = new FakeDshAgentRegistry()
      const parentAgent: AgentStub = { id: "parent-1", session: { id: "parent-1", header: {} } }
      registry.enter(parentAgent, undefined)

      // Properly created child agent with parentAgent
      const childAgent: AgentStub = {
        id: "child-agent-1",
        session: { id: "child-agent-1", header: { origin: "subagent", parentSession: "parent-1" } },
      }
      registry.enter(childAgent, parentAgent) // runtime owner = parentAgent

      expect(registry.roots()).not.toContain(childAgent)
      expect(registry.isOwnedBy(childAgent.id, parentAgent)).toBe(true)

      let answererCalled = false
      const questions = new FakeDshUserQuestions(registry, async () => {
        answererCalled = true
        return { answers: [] }
      })

      await expect(questions.ask({ questions: [{ id: "q1" }], agent: childAgent })).rejects.toMatchObject({
        code: "DELEGATED_CALLER",
      })
      // Crucial: answerer must NEVER be called for delegated agent
      expect(answererCalled).toBe(false)
    })

    test("Case 4: Nonexistent or disposed agent throws CALLER_NOT_LIVE", async () => {
      const registry = new FakeDshAgentRegistry()
      const rootAgent: AgentStub = { id: "root-1", session: { id: "root-1", header: {} } }
      registry.enter(rootAgent, undefined)

      const questions = new FakeDshUserQuestions(registry, async () => ({ answers: [] }))

      // Disposed agent (unregistered from registry)
      const disposedAgent: AgentStub = { id: "disposed-1", session: { id: "disposed-1", header: {} } }
      await expect(questions.ask({ questions: [{ id: "q1" }], agent: disposedAgent })).rejects.toMatchObject({
        code: "CALLER_NOT_LIVE",
      })

      // Also after disposing rootAgent
      registry.dispose("root-1")
      await expect(questions.ask({ questions: [{ id: "q1" }], agent: rootAgent })).rejects.toMatchObject({
        code: "CALLER_NOT_LIVE",
      })
    })

    test("Case 5: Absence of answerer for valid root agent throws NO_PROVIDER", async () => {
      const registry = new FakeDshAgentRegistry()
      const rootAgent: AgentStub = { id: "root-1", session: { id: "root-1", header: {} } }
      registry.enter(rootAgent, undefined)

      const questions = new FakeDshUserQuestions(registry, undefined) // No provider registered

      await expect(questions.ask({ questions: [{ id: "q1" }], agent: rootAgent })).rejects.toMatchObject({
        code: "NO_PROVIDER",
      })
    })
  })

  describe("RED reproduction: central safety risk (selection != mutation authorization)", () => {
    test("rejects evidence where option selection granted mutation authorization", () => {
      const invalid = {
        ...completeNativeQuestionsEvidence,
        behaviors: {
          ...completeNativeQuestionsEvidence.behaviors,
          selectRecommendation: {
            ...completeNativeQuestionsEvidence.behaviors.selectRecommendation,
            mutationAuthorized: true,
          },
        },
      }
      const errors = validateNativeQuestionsEvidence(invalid)
      expect(errors).toContain(
        "central safety risk violation: selecting a recommendation must not grant mutation authorization",
      )
      expect(classifyNativeQuestionsStatus(invalid)).toBe("FAIL")
    })

    test("rejects evidence where requestMoreEvidence granted mutation authorization", () => {
      const invalid = {
        ...completeNativeQuestionsEvidence,
        behaviors: {
          ...completeNativeQuestionsEvidence.behaviors,
          requestMoreEvidence: {
            ...completeNativeQuestionsEvidence.behaviors.requestMoreEvidence,
            mutationAuthorized: true,
          },
        },
      }
      expect(validateNativeQuestionsEvidence(invalid)).toContain(
        "requesting more evidence must not grant mutation authorization",
      )
      expect(classifyNativeQuestionsStatus(invalid)).toBe("FAIL")
    })

    test("rejects evidence where deferring decision granted mutation authorization", () => {
      const invalid = {
        ...completeNativeQuestionsEvidence,
        behaviors: {
          ...completeNativeQuestionsEvidence.behaviors,
          deferDecision: {
            ...completeNativeQuestionsEvidence.behaviors.deferDecision,
            mutationAuthorized: true,
          },
        },
      }
      expect(validateNativeQuestionsEvidence(invalid)).toContain(
        "deferring a decision must not grant mutation authorization",
      )
      expect(classifyNativeQuestionsStatus(invalid)).toBe("FAIL")
    })

    test("rejects evidence where custom response granted mutation authorization", () => {
      const invalid = {
        ...completeNativeQuestionsEvidence,
        behaviors: {
          ...completeNativeQuestionsEvidence.behaviors,
          customResponse: {
            ...completeNativeQuestionsEvidence.behaviors.customResponse,
            mutationAuthorized: true,
          },
        },
      }
      expect(validateNativeQuestionsEvidence(invalid)).toContain(
        "providing a custom answer must not grant mutation authorization",
      )
      expect(classifyNativeQuestionsStatus(invalid)).toBe("FAIL")
    })

    test("rejects evidence where manuscript was modified following question selection", () => {
      const invalid = {
        ...completeNativeQuestionsEvidence,
        behaviors: {
          ...completeNativeQuestionsEvidence.behaviors,
          selectionDoesNotAuthorizeMutation: {
            ...completeNativeQuestionsEvidence.behaviors.selectionDoesNotAuthorizeMutation,
            manuscriptPreserved: false,
          },
        },
      }
      expect(validateNativeQuestionsEvidence(invalid)).toContain(
        "academic manuscript was mutated by question selection workflow",
      )
      expect(classifyNativeQuestionsStatus(invalid)).toBe("FAIL")
    })

    test("rejects evidence where mutation was dispatched without approval grant", () => {
      const invalid = {
        ...completeNativeQuestionsEvidence,
        behaviors: {
          ...completeNativeQuestionsEvidence.behaviors,
          selectionDoesNotAuthorizeMutation: {
            ...completeNativeQuestionsEvidence.behaviors.selectionDoesNotAuthorizeMutation,
            mutationDispatched: true,
          },
        },
      }
      expect(validateNativeQuestionsEvidence(invalid)).toContain(
        "mutation tool was dispatched without independent approval grant",
      )
      expect(classifyNativeQuestionsStatus(invalid)).toBe("FAIL")
    })
  })

  describe("Negative contract cases", () => {
    test("rejects missing host API", () => {
      expect(classifyNativeQuestionsStatus(undefined)).toBe("BLOCKED")
      expect(classifyNativeQuestionsStatus({})).toBe("BLOCKED")
      expect(classifyNativeQuestionsStatus({ hostApiAvailable: false })).toBe("BLOCKED")
    })

    test("rejects when userQuestions service is missing", () => {
      const invalid = { ...completeNativeQuestionsEvidence, userQuestionsServiceAvailable: false }
      expect(validateNativeQuestionsEvidence(invalid)).toContain(
        "ctx.userQuestions service is unavailable on host",
      )
      expect(classifyNativeQuestionsStatus(invalid)).toBe("FAIL")
    })

    test("rejects when approval service is missing", () => {
      const invalid = { ...completeNativeQuestionsEvidence, approvalServiceAvailable: false }
      expect(validateNativeQuestionsEvidence(invalid)).toContain(
        "ctx.approval service is unavailable on host",
      )
      expect(classifyNativeQuestionsStatus(invalid)).toBe("FAIL")
    })

    test("rejects evidence where cancellation was not handled", () => {
      const invalid = {
        ...completeNativeQuestionsEvidence,
        behaviors: {
          ...completeNativeQuestionsEvidence.behaviors,
          cancelQuestion: {
            ...completeNativeQuestionsEvidence.behaviors.cancelQuestion,
            cancelled: false,
          },
        },
      }
      expect(validateNativeQuestionsEvidence(invalid)).toContain(
        "question cancellation was not verified with ASK_ABORTED error",
      )
      expect(classifyNativeQuestionsStatus(invalid)).toBe("FAIL")
    })

    test("rejects evidence where delegated agent was not blocked", () => {
      const invalid = {
        ...completeNativeQuestionsEvidence,
        behaviors: {
          ...completeNativeQuestionsEvidence.behaviors,
          delegatedAgentBlocked: {
            ...completeNativeQuestionsEvidence.behaviors.delegatedAgentBlocked,
            blocked: false,
          },
        },
      }
      expect(validateNativeQuestionsEvidence(invalid)).toContain(
        "delegated agent must be blocked from userQuestions with DELEGATED_CALLER",
      )
      expect(classifyNativeQuestionsStatus(invalid)).toBe("FAIL")
    })

    test("rejects evidence where incompatible answer was not rejected", () => {
      const invalid = {
        ...completeNativeQuestionsEvidence,
        behaviors: {
          ...completeNativeQuestionsEvidence.behaviors,
          rejectIncompatibleAnswer: {
            ...completeNativeQuestionsEvidence.behaviors.rejectIncompatibleAnswer,
            rejected: false,
          },
        },
      }
      expect(validateNativeQuestionsEvidence(invalid)).toContain(
        "incompatible or mismatched answer was not rejected",
      )
      expect(classifyNativeQuestionsStatus(invalid)).toBe("FAIL")
    })

    test("rejects evidence where non-grant approval outcomes do not deny in PASS status", () => {
      const invalid = {
        ...fullPassNativeQuestionsEvidence,
        independentApproval: {
          ...fullPassNativeQuestionsEvidence.independentApproval,
          nonGrantsDeny: {
            rejectedDenies: false,
            cancelledDenies: true,
            unavailableDenies: true,
          },
        },
      }
      expect(validateNativeQuestionsEvidence(invalid)).toContain(
        "non-grant approval outcome 'rejected' must deny authorization",
      )
      expect(classifyNativeQuestionsStatus(invalid)).toBe("FAIL")
    })

    test("rejects evidence claiming allowed-once is not the sole grant in PASS status", () => {
      const invalid = {
        ...fullPassNativeQuestionsEvidence,
        independentApproval: {
          ...fullPassNativeQuestionsEvidence.independentApproval,
          allowedOnceIsSoleGrant: false,
        },
      }
      expect(validateNativeQuestionsEvidence(invalid)).toContain(
        "allowed-once must be the sole granting outcome in DSH approval contract",
      )
      expect(classifyNativeQuestionsStatus(invalid)).toBe("FAIL")
    })

    test("rejects evidence where model execution was used", () => {
      const invalid = { ...completeNativeQuestionsEvidence, modelExecutionUsed: true }
      expect(validateNativeQuestionsEvidence(invalid)).toContain(
        "native questions probe used unauthorized model execution",
      )
      expect(classifyNativeQuestionsStatus(invalid)).toBe("FAIL")
    })

    test("rejects evidence claiming synthetic answerer is real Web UI", () => {
      const invalid = { ...completeNativeQuestionsEvidence, uiWebDisclaimer: "" }
      expect(validateNativeQuestionsEvidence(invalid)).toContain(
        "evidence must contain explicit disclaimer that synthetic answerer is not real Web UI",
      )
      expect(classifyNativeQuestionsStatus(invalid)).toBe("FAIL")
    })
  })

  describe("P1 & P2 approval review blockers (absence of provider, 1:1 pair cardinality & strict boundaries)", () => {
    test("P1 RED: rejects when unavailable outcome is produced by voluntary answerer return instead of host fallback", () => {
      const voluntaryUnavailable = {
        ...fullPassNativeQuestionsEvidence,
        independentApproval: {
          ...fullPassNativeQuestionsEvidence.independentApproval,
          unavailableProvedByAbsenceOfProvider: false,
          syntheticAnswererInterceptedUnavailable: true,
          observedDecisions: fullPassNativeQuestionsEvidence.independentApproval.observedDecisions?.map((d) =>
            d.outcome === "unavailable" ? { ...d, unansweredByProvider: false } : d,
          ),
        },
      }
      const errors = validateNativeQuestionsEvidence(voluntaryUnavailable)
      expect(errors).toContain("unavailable outcome must be proved by absence of provider (host fallback), not voluntary answerer return")
      expect(errors).toContain("synthetic answerer intercepted unavailable request instead of exercising host fallback")
      expect(errors).toContain("unavailable decision must prove it was unanswered by any provider")
      expect(classifyNativeQuestionsStatus(voluntaryUnavailable)).toBe("FAIL")
    })

    test("P2 RED: rejects when decision count is not exactly 4", () => {
      const incomplete = {
        ...fullPassNativeQuestionsEvidence,
        independentApproval: {
          ...fullPassNativeQuestionsEvidence.independentApproval,
          observedDecisions: fullPassNativeQuestionsEvidence.independentApproval.observedDecisions?.slice(0, 3),
        },
      }
      const errors = validateNativeQuestionsEvidence(incomplete)
      expect(errors).toContain("observedDecisions must contain exactly 4 observed decisions, one for each native outcome")
      expect(classifyNativeQuestionsStatus(incomplete)).toBe("FAIL")
    })

    test("P2 RED: rejects duplicate requestId in observedDecisions", () => {
      const duplicate = {
        ...fullPassNativeQuestionsEvidence,
        independentApproval: {
          ...fullPassNativeQuestionsEvidence.independentApproval,
          observedDecisions: fullPassNativeQuestionsEvidence.independentApproval.observedDecisions?.map((d, i) =>
            i === 1 ? { ...d, requestId: "appr-req-001" } : d,
          ),
        },
      }
      const errors = validateNativeQuestionsEvidence(duplicate)
      expect(errors).toContain("duplicate requestId in observedDecisions: appr-req-001")
      expect(classifyNativeQuestionsStatus(duplicate)).toBe("FAIL")
    })

    test("P2 RED: rejects missing numeric seq or fallback turnSeq substitution", () => {
      // 1. Missing numeric seq
      const missingSeq = {
        ...fullPassNativeQuestionsEvidence,
        independentApproval: {
          ...fullPassNativeQuestionsEvidence.independentApproval,
          observedDecisions: fullPassNativeQuestionsEvidence.independentApproval.observedDecisions?.map((d, i) =>
            i === 0 ? { ...d, askedSeq: undefined as unknown as number } : d,
          ),
        },
      }
      expect(validateNativeQuestionsEvidence(missingSeq)).toContain(
        "observedDecision must contain strict numeric turnSeq, askedSeq, and decidedSeq without fallbacks",
      )

      // 2. Fallback substitution where turnSeq is 1 while askedSeq is 4
      const fallbackSeq = {
        ...fullPassNativeQuestionsEvidence,
        independentApproval: {
          ...fullPassNativeQuestionsEvidence.independentApproval,
          observedDecisions: fullPassNativeQuestionsEvidence.independentApproval.observedDecisions?.map((d, i) =>
            i === 1 ? { ...d, turnSeq: 1, askedSeq: 4 } : d,
          ),
        },
      }
      expect(validateNativeQuestionsEvidence(fallbackSeq)).toContain(
        "turnSeq must strictly match askedSeq without fallback substitution",
      )
    })

    test("P2 RED: rejects when asked event occurs before or at turn/start", () => {
      const beforeStart = {
        ...fullPassNativeQuestionsEvidence,
        independentApproval: {
          ...fullPassNativeQuestionsEvidence.independentApproval,
          observedDecisions: fullPassNativeQuestionsEvidence.independentApproval.observedDecisions?.map((d, i) =>
            i === 0 ? { ...d, askedSeq: 1, turnSeq: 1 } : d,
          ),
        },
      }
      expect(validateNativeQuestionsEvidence(beforeStart)).toContain(
        "approval/asked event must occur strictly after turn/start (askedSeq 1 <= turnStartSeq 1)",
      )
      expect(classifyNativeQuestionsStatus(beforeStart)).toBe("FAIL")
    })

    test("P2 RED: rejects when decided event occurs before or at asked event", () => {
      const outOfOrderPair = {
        ...fullPassNativeQuestionsEvidence,
        independentApproval: {
          ...fullPassNativeQuestionsEvidence.independentApproval,
          observedDecisions: fullPassNativeQuestionsEvidence.independentApproval.observedDecisions?.map((d, i) =>
            i === 0 ? { ...d, askedSeq: 3, decidedSeq: 2, turnSeq: 3 } : d,
          ),
        },
      }
      expect(validateNativeQuestionsEvidence(outOfOrderPair)).toContain(
        "approval/decided event must occur strictly after approval/asked (decidedSeq 2 <= askedSeq 3)",
      )
      expect(classifyNativeQuestionsStatus(outOfOrderPair)).toBe("FAIL")
    })

    test("P2 RED: rejects when decided event occurs after or at turn/end", () => {
      const afterEnd = {
        ...fullPassNativeQuestionsEvidence,
        independentApproval: {
          ...fullPassNativeQuestionsEvidence.independentApproval,
          observedDecisions: fullPassNativeQuestionsEvidence.independentApproval.observedDecisions?.map((d, i) =>
            i === 3 ? { ...d, decidedSeq: 10 } : d,
          ),
        },
      }
      expect(validateNativeQuestionsEvidence(afterEnd)).toContain(
        "approval/decided event must occur strictly before turn/end (decidedSeq 10 >= turnEndSeq 10)",
      )
      expect(classifyNativeQuestionsStatus(afterEnd)).toBe("FAIL")
    })

    test("P2 RED: rejects when turn integrity is missing or invalid", () => {
      const missingIntegrity = {
        ...fullPassNativeQuestionsEvidence,
        independentApproval: {
          ...fullPassNativeQuestionsEvidence.independentApproval,
          turnIntegrity: undefined,
        },
      }
      expect(validateNativeQuestionsEvidence(missingIntegrity)).toContain(
        "approval turn integrity must prove a single closed turn",
      )
      expect(classifyNativeQuestionsStatus(missingIntegrity)).toBe("FAIL")

      const invalidBoundaries = {
        ...fullPassNativeQuestionsEvidence,
        independentApproval: {
          ...fullPassNativeQuestionsEvidence.independentApproval,
          turnIntegrity: { singleTurnClosed: true, turnStartSeq: 10, turnEndSeq: 5 },
        },
      }
      expect(validateNativeQuestionsEvidence(invalidBoundaries)).toContain(
        "turnIntegrity must contain valid numeric turnStartSeq < turnEndSeq",
      )
      expect(classifyNativeQuestionsStatus(invalidBoundaries)).toBe("FAIL")
    })

    test("P2 RED: rejects when decision pairs overlap or are out of order across pairs", () => {
      const overlapping = {
        ...fullPassNativeQuestionsEvidence,
        independentApproval: {
          ...fullPassNativeQuestionsEvidence.independentApproval,
          observedDecisions: fullPassNativeQuestionsEvidence.independentApproval.observedDecisions?.map((d, i) =>
            i === 1 ? { ...d, askedSeq: 3, decidedSeq: 4, turnSeq: 3 } : d,
          ),
        },
      }
      expect(validateNativeQuestionsEvidence(overlapping)).toContain(
        "approval decisions must be strictly sequentially ordered without overlap",
      )
      expect(classifyNativeQuestionsStatus(overlapping)).toBe("FAIL")
    })

    test("P2 RED: rejects when tool name does not match expected outcome", () => {
      const mismatchedTool = {
        ...fullPassNativeQuestionsEvidence,
        independentApproval: {
          ...fullPassNativeQuestionsEvidence.independentApproval,
          observedDecisions: fullPassNativeQuestionsEvidence.independentApproval.observedDecisions?.map((d, i) =>
            i === 0 ? { ...d, toolName: "academic_approval_rejected_action" } : d,
          ),
        },
      }
      expect(validateNativeQuestionsEvidence(mismatchedTool)).toContain(
        "observedDecisions must contain 1:1 mapping of expected approval tools to native outcomes (mismatch for tool 'academic_approval_rejected_action' with outcome 'allowed-once')",
      )
      expect(classifyNativeQuestionsStatus(mismatchedTool)).toBe("FAIL")
    })
  })

  describe("Positive contract case", () => {
    test("accepts complete valid evidence with BLOCKED approval subgate (pre-lifecycle)", () => {
      expect(validateNativeQuestionsEvidence(completeNativeQuestionsEvidence)).toEqual([])
      expect(classifyNativeQuestionsStatus(completeNativeQuestionsEvidence)).toBe("BLOCKED")
    })

    test("accepts complete valid evidence with PASS approval subgate only when observedDecisions with audit events are present", () => {
      expect(validateNativeQuestionsEvidence(fullPassNativeQuestionsEvidence)).toEqual([])
      expect(classifyNativeQuestionsStatus(fullPassNativeQuestionsEvidence)).toBe("PASS")
    })
  })

  describe("Gate classification integration", () => {
    test("incorporates nativeQuestionsStatus into gate summary while preserving earlier gates", () => {
      expect(
        classifyProfileGateStatuses("PASS", "PASS", "PASS", "PASS", "PASS"),
      ).toEqual({
        issue2Status: "PASS",
        auditorMarkdownStatus: "PASS",
        nativeSkillsStatus: "PASS",
        batchAuditStatus: "PASS",
        nativeQuestionsStatus: "PASS",
        overallStatus: "PASS",
        exitCode: 0,
      })

      expect(
        classifyProfileGateStatuses("PASS", "PASS", "PASS", "PASS", "BLOCKED"),
      ).toEqual({
        issue2Status: "PASS",
        auditorMarkdownStatus: "PASS",
        nativeSkillsStatus: "PASS",
        batchAuditStatus: "PASS",
        nativeQuestionsStatus: "BLOCKED",
        overallStatus: "BLOCKED",
        exitCode: 2,
      })

      expect(
        classifyProfileGateStatuses("PASS", "PASS", "PASS", "PASS", "FAIL"),
      ).toEqual({
        issue2Status: "PASS",
        auditorMarkdownStatus: "PASS",
        nativeSkillsStatus: "PASS",
        batchAuditStatus: "PASS",
        nativeQuestionsStatus: "FAIL",
        overallStatus: "FAIL",
        exitCode: 1,
      })
    })
  })
})
