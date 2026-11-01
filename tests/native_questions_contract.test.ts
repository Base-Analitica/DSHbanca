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
      blocked: true,
      errorCode: "DELEGATED_CALLER",
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
    observedDecisions: [
      {
        requestId: "appr-req-001",
        agentId: "agent-root-test",
        sessionId: "sess-turn-001",
        toolName: "academic_nonmutating_action",
        turnSeq: 3,
        outcome: "allowed-once",
        auditEvents: {
          askedEventLogged: true,
          decidedEventLogged: true,
        },
      },
      {
        requestId: "appr-req-002",
        agentId: "agent-root-test",
        sessionId: "sess-turn-001",
        toolName: "academic_nonmutating_action",
        turnSeq: 4,
        outcome: "rejected",
        auditEvents: {
          askedEventLogged: true,
          decidedEventLogged: true,
        },
      },
      {
        requestId: "appr-req-003",
        agentId: "agent-root-test",
        sessionId: "sess-turn-001",
        toolName: "academic_nonmutating_action",
        turnSeq: 5,
        outcome: "cancelled",
        auditEvents: {
          askedEventLogged: true,
          decidedEventLogged: true,
        },
      },
      {
        requestId: "appr-req-004",
        agentId: "agent-root-test",
        sessionId: "sess-turn-001",
        toolName: "academic_nonmutating_action",
        turnSeq: 6,
        outcome: "unavailable",
        auditEvents: {
          askedEventLogged: true,
          decidedEventLogged: true,
        },
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
