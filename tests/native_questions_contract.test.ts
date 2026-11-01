import { describe, expect, test } from "bun:test"
import {
  classifyNativeQuestionsStatus,
  classifyProfileGateStatuses,
  validateNativeQuestionsEvidence,
  type NativeQuestionsEvidence,
} from "../scripts/lib/dsh-profile-e2e-contract.js"

const completeNativeQuestionsEvidence: NativeQuestionsEvidence = {
  hostApiAvailable: true,
  userQuestionsServiceAvailable: true,
  approvalServiceAvailable: true,
  syntheticScenarioCompleted: true,
  behaviors: {
    selectRecommendation: {
      questionId: "q-academic-rec-1",
      selectedOption: "Adotar recomendação: Adicionar seção de Trabalhos Relacionados",
      isRecommendation: true,
      answered: true,
      mutationAuthorized: false,
    },
    requestMoreEvidence: {
      questionId: "q-academic-evid-1",
      selectedOption: "Não sei — explique/mostre evidências",
      answered: true,
      mutationAuthorized: false,
    },
    deferDecision: {
      questionId: "q-academic-defer-1",
      selectedOption: "Adiar / continuar outras etapas",
      answered: true,
      mutationAuthorized: false,
    },
    customResponse: {
      questionId: "q-academic-custom-1",
      customText: "Outro: Manter escopo atual conforme deliberação do orientador",
      answered: true,
      mutationAuthorized: false,
    },
    cancelQuestion: {
      questionId: "q-academic-cancel-1",
      cancelled: true,
      errorCode: "ASK_ABORTED",
    },
    rejectIncompatibleAnswer: {
      rejected: true,
      errorCode: "BAD_ANSWER",
    },
    delegatedAgentBlocked: {
      blocked: true,
      errorCode: "DELEGATED_CALLER",
    },
    selectionDoesNotAuthorizeMutation: {
      attemptedTool: "banca_corrigir",
      selectionReceived: true,
      mutationDispatched: false,
      manuscriptPreserved: true,
      approvalOutcomeIfNotApproved: "unavailable",
    },
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
  uiWebDisclaimer: "Synthetic answerer for native DSH contract verification only; not proof of real Web UI or interactive browser session.",
  modelExecutionUsed: false,
}

describe("DSH native questions and independent approval contract (#46)", () => {
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

    test("rejects evidence where non-grant approval outcomes (rejected, cancelled, unavailable) do not deny", () => {
      const invalid = {
        ...completeNativeQuestionsEvidence,
        independentApproval: {
          ...completeNativeQuestionsEvidence.independentApproval,
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

    test("rejects evidence claiming allowed-once is not the sole grant", () => {
      const invalid = {
        ...completeNativeQuestionsEvidence,
        independentApproval: {
          ...completeNativeQuestionsEvidence.independentApproval,
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
    test("accepts complete positive native questions evidence", () => {
      expect(validateNativeQuestionsEvidence(completeNativeQuestionsEvidence)).toEqual([])
      expect(classifyNativeQuestionsStatus(completeNativeQuestionsEvidence)).toBe("PASS")
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
