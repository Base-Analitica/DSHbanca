/**
 * Pure domain module for selectable academic decisions over the native DSH userQuestions seam.
 *
 * Implements the non-mutating academic decision cycle for banca-grille:
 * - 2 to 4 concrete, evidence-grounded alternatives
 * - Grounded recommendation with explicit justification (marked with "(Recommended)")
 * - Standard safe controls: "Não sei / mostrar evidências", "Adiar", "Outro" (custom response)
 * - Strict safety invariant: selection NEVER authorizes manuscript mutation (mutationAuthorized = false)
 * - Fail-closed error handling: invalid alternatives, missing evidence, duplicate questions,
 *   subagent callers, service unavailability, timeouts and cancellations all terminate safely.
 */

export const SAFE_OPTION_EVIDENCE = "Não sei — explique/mostre evidências" as const
export const SAFE_OPTION_DEFER = "Adiar / continuar outras etapas" as const

export interface AcademicAlternative {
  label: string
  description: string
  consequence?: string
  risks?: string
  evidence?: string
  isRecommendation?: boolean
}

export interface AcademicDecisionInput {
  id: string
  prompt: string
  header?: string
  findingId?: string
  evidence: string
  alternatives: AcademicAlternative[]
  recommendation?: {
    alternativeIndex: number
    justification: string
  }
  allowCustom?: boolean
  allowEvidenceRequest?: boolean
  allowDefer?: boolean
}

export interface AcademicDecisionQuestion {
  id: string
  question: string
  header?: string
  options: Array<{
    label: string
    description: string
  }>
}

export interface AcademicDecisionResult {
  id: string
  selected: string[]
  custom?: string
  outcome:
    | "selected_recommendation"
    | "selected_alternative"
    | "requested_evidence"
    | "deferred"
    | "custom_response"
  selectedLabel?: string
  mutationAuthorized: false
  orientation: string
  nextSteps: string[]
}

export class AcademicDecisionError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(`[${code}] ${message}`)
    this.name = "AcademicDecisionError"
    this.code = code
  }
}

/**
 * Validates and formats an academic decision input into a native DSH question schema.
 */
export function formatAcademicDecisionQuestion(
  input: AcademicDecisionInput,
): AcademicDecisionQuestion {
  if (!input.evidence || typeof input.evidence !== "string" || input.evidence.trim() === "") {
    throw new AcademicDecisionError(
      "NO_EVIDENCE",
      "Ausência de evidências acadêmicas para formular a decisão.",
    )
  }

  if (
    !Array.isArray(input.alternatives) ||
    input.alternatives.length < 2 ||
    input.alternatives.length > 4
  ) {
    throw new AcademicDecisionError(
      "INVALID_ALTERNATIVES",
      "Decisão deve conter entre 2 e 4 alternativas concretas e distintas.",
    )
  }

  const seenLabels = new Set<string>()
  for (const alt of input.alternatives) {
    if (!alt.label || typeof alt.label !== "string" || alt.label.trim() === "") {
      throw new AcademicDecisionError(
        "INVALID_ALTERNATIVES",
        "Toda alternativa deve conter uma descrição/rótulo não vazia.",
      )
    }
    const cleanLabel = alt.label.trim()
    if (seenLabels.has(cleanLabel)) {
      throw new AcademicDecisionError(
        "INVALID_ALTERNATIVES",
        `Alternativa duplicada detectada: "${cleanLabel}".`,
      )
    }
    seenLabels.add(cleanLabel)
  }

  let recommendedIdx = -1
  if (input.recommendation !== undefined) {
    const { alternativeIndex, justification } = input.recommendation
    if (
      typeof alternativeIndex !== "number" ||
      alternativeIndex < 0 ||
      alternativeIndex >= input.alternatives.length
    ) {
      throw new AcademicDecisionError(
        "INVALID_RECOMMENDATION",
        "Índice da alternativa recomendada fora do intervalo válido.",
      )
    }
    if (!justification || typeof justification !== "string" || justification.trim() === "") {
      throw new AcademicDecisionError(
        "INVALID_RECOMMENDATION",
        "Recomendação acadêmica exige justificativa fundamentada.",
      )
    }
    recommendedIdx = alternativeIndex
  } else {
    // Check if any alternative has isRecommendation=true
    const foundIdx = input.alternatives.findIndex((a) => a.isRecommendation === true)
    if (foundIdx !== -1) {
      recommendedIdx = foundIdx
    }
  }

  const options: Array<{ label: string; description: string }> = []

  // If there is a recommended alternative, put it first with "(Recommended)"
  if (recommendedIdx !== -1) {
    const recAlt = input.alternatives[recommendedIdx]
    const labelWithRec = recAlt.label.includes("(Recommended)")
      ? recAlt.label
      : `${recAlt.label} (Recommended)`
    options.push({
      label: labelWithRec,
      description: recAlt.description || "Recomendado com base nas evidências disponíveis.",
    })
  }

  for (let i = 0; i < input.alternatives.length; i++) {
    if (i === recommendedIdx) continue
    const alt = input.alternatives[i]
    options.push({
      label: alt.label,
      description: alt.description || alt.label,
    })
  }

  if (input.allowEvidenceRequest !== false) {
    options.push({
      label: SAFE_OPTION_EVIDENCE,
      description: "Explicar a dúvida, trechos do manuscrito e riscos antes de exigir uma decisão.",
    })
  }

  if (input.allowDefer !== false) {
    options.push({
      label: SAFE_OPTION_DEFER,
      description: "Preservar a pendência e continuar apenas trabalhos independentes e seguros.",
    })
  }

  return {
    id: input.id,
    question: input.prompt,
    ...(input.header ? { header: input.header } : { header: "Decisão Acadêmica" }),
    options,
  }
}

/**
 * Validates and processes a raw answer from the native DSH userQuestions seam.
 * Enforces strictly that mutationAuthorized is false and maps user choice to non-mutating orientation.
 */
export function processAcademicDecisionAnswer(
  input: AcademicDecisionInput,
  question: AcademicDecisionQuestion,
  rawAnswer: { id: string; selected?: string[]; custom?: string },
): AcademicDecisionResult {
  if (rawAnswer.id !== question.id) {
    throw new AcademicDecisionError(
      "MISMATCHED_ID",
      `Identificador da resposta (${rawAnswer.id}) diverge da pergunta formulada (${question.id}).`,
    )
  }

  const validOptionLabels = new Set(question.options.map((o) => o.label))
  const selected = Array.isArray(rawAnswer.selected) ? rawAnswer.selected : []
  const custom = typeof rawAnswer.custom === "string" && rawAnswer.custom.trim() !== ""
    ? rawAnswer.custom.trim()
    : undefined

  for (const sel of selected) {
    if (!validOptionLabels.has(sel)) {
      throw new AcademicDecisionError(
        "INVALID_ANSWER",
        `Opção selecionada "${sel}" não consta na lista de alternativas válidas.`,
      )
    }
  }

  if (selected.length === 0 && !custom) {
    throw new AcademicDecisionError(
      "INVALID_ANSWER",
      "Resposta inválida: nenhuma opção selecionada e nenhuma resposta personalizada fornecida.",
    )
  }

  // Handle custom response ("Outro")
  if (custom && selected.length === 0) {
    return {
      id: question.id,
      selected: [],
      custom,
      outcome: "custom_response",
      mutationAuthorized: false,
      orientation: `Orientação personalizada definida pelo autor: "${custom}".`,
      nextSteps: [
        "investigar_viabilidade_orientacao",
        "preparar_proposta_examinavel",
      ],
    }
  }

  const primarySelection = selected[0]

  if (primarySelection === SAFE_OPTION_EVIDENCE) {
    return {
      id: question.id,
      selected,
      ...(custom ? { custom } : {}),
      outcome: "requested_evidence",
      selectedLabel: primarySelection,
      mutationAuthorized: false,
      orientation:
        "Autor solicitou detalhamento das evidências acadêmicas e riscos antes de deliberar.",
      nextSteps: [
        "apresentar_trechos_e_evidencias",
        "detalhar_riscos_e_implicacoes",
        "aguardar_deliberacao_do_autor",
      ],
    }
  }

  if (primarySelection === SAFE_OPTION_DEFER) {
    return {
      id: question.id,
      selected,
      ...(custom ? { custom } : {}),
      outcome: "deferred",
      selectedLabel: primarySelection,
      mutationAuthorized: false,
      orientation:
        "Decisão acadêmica adiada com segurança. Pendência preservada sem bloqueio de etapas independentes.",
      nextSteps: [
        "preservar_pendencia_continuar_independentes",
      ],
    }
  }

  const isRec = primarySelection.includes("(Recommended)")
  return {
    id: question.id,
    selected,
    ...(custom ? { custom } : {}),
    outcome: isRec ? "selected_recommendation" : "selected_alternative",
    selectedLabel: primarySelection,
    mutationAuthorized: false,
    orientation: `Direcionamento selecionado pelo autor: "${primarySelection}". Elaborar proposta examinável sem alterar o manuscrito.`,
    nextSteps: [
      "investigar_evidencias",
      "preparar_proposta_examinavel",
      "gerar_diff_proposto",
    ],
  }
}

export interface RunAcademicDecisionOptions {
  ctx: any
  agent: any
  decisionInput: AcademicDecisionInput
  parentAgent?: any
  signal?: AbortSignal
  activeQuestionIds?: Set<string>
  onTeardown?: () => void
}

/**
 * Runs a complete, safe academic decision cycle using the native DSH userQuestions seam.
 */
export async function runAcademicDecisionCycle(
  options: RunAcademicDecisionOptions,
): Promise<AcademicDecisionResult> {
  const { ctx, agent, decisionInput, parentAgent, signal, activeQuestionIds, onTeardown } = options

  try {
    if (!agent || typeof agent !== "object") {
      throw new AcademicDecisionError(
        "INVALID_SESSION_CONTEXT",
        "Contexto de agente/sessão inválido ou ausente.",
      )
    }

    if (activeQuestionIds && activeQuestionIds.has(decisionInput.id)) {
      throw new AcademicDecisionError(
        "DUPLICATE_QUESTION",
        `Identificador de pergunta "${decisionInput.id}" já utilizado nesta sessão.`,
      )
    }

    // Verify calling agent identity & delegated permissions
    const origin = agent.session?.header?.origin
    const isSubagent = origin === "subagent"
    const isOwned = parentAgent && ctx?.agents?.isOwnedBy?.(agent.id, parentAgent) === true
    const notInRoots = ctx?.agents?.roots && !ctx.agents.roots().includes(agent)

    if (isSubagent && (isOwned || notInRoots)) {
      const err: any = new AcademicDecisionError(
        "DELEGATED_CALLER",
        "Agente delegado (subagent) não possui permissão para abrir diálogo direto de pergunta com o usuário.",
      )
      err.code = "DELEGATED_CALLER"
      throw err
    }

    if (!ctx?.userQuestions || typeof ctx.userQuestions.ask !== "function") {
      throw new AcademicDecisionError(
        "SERVICE_UNAVAILABLE",
        "Serviço nativo ctx.userQuestions do DSH indisponível no contexto atual.",
      )
    }

    const question = formatAcademicDecisionQuestion(decisionInput)

    if (signal?.aborted) {
      const err: any = new AcademicDecisionError("ASK_ABORTED", "Pergunta cancelada antes do envio.")
      err.code = "ASK_ABORTED"
      throw err
    }

    activeQuestionIds?.add(decisionInput.id)

    let rawResponse: any
    try {
      rawResponse = await ctx.userQuestions.ask({
        questions: [question],
        agent,
        signal,
      })
    } catch (err: any) {
      if (err instanceof AcademicDecisionError) throw err
      if (err?.code === "NO_PROVIDER") {
        throw new AcademicDecisionError("NO_PROVIDER", "Nenhum answerer disponível para responder.")
      }
      if (err?.code === "ASK_ABORTED") {
        throw new AcademicDecisionError("ASK_ABORTED", "Pergunta cancelada antes da resposta.")
      }
      throw err
    }

    const rawAnswer = rawResponse?.answers?.find((a: any) => a.id === question.id)
    if (!rawAnswer) {
      throw new AcademicDecisionError(
        "INVALID_ANSWER",
        `Resposta para a pergunta "${question.id}" não foi encontrada no retorno do serviço.`,
      )
    }

    return processAcademicDecisionAnswer(decisionInput, question, rawAnswer)
  } finally {
    if (onTeardown) {
      try {
        onTeardown()
      } catch {
        // Safe swallow teardown error to avoid masking root cause
      }
    }
  }
}
