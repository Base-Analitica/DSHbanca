---
name: banca-avaliacao
description: Protocolo de auditoria exaustiva por lotes canônicos com síntese global apenas após cobertura completa.
---
# Skill: Banca Avaliação

Orquestra a auditoria acadêmica exaustiva do manuscrito canônico, lote a lote, e só então obtém a entrada de síntese global. Não calcula pontuação numérica global, aprovação ou reprovação.

## Quando usar
Sempre que for necessário auditar o manuscrito de forma exaustiva, cobrindo todos os lotes planejados, e preparar a síntese global após a cobertura completa.

## Quando NÃO usar
- Não use para aplicar correções no manuscrito.
- Não use para calcular pontuação, pesos, tetos, travas, aprovação ou reprovação.
- Não use para triagem exclusiva de IA sem análise de conteúdo.
- Não use para emitir parecer integral antes da cobertura completa de todos os lotes.

## Entradas necessárias
- Diretório do projeto da monografia (raiz com o manuscrito canônico).
- Respostas das tools `banca_context`, `read` (context pack), `banca_auditar` e, ao final, `banca_sintese`.

## Ferramentas permitidas
- `banca_context`
- `read` — somente no caminho exato do context pack retornado (`.banca/context/context-*.md`)
- `banca_auditar`
- `banca_sintese`

## Protocolo exaustivo por lotes

1. Chamar `banca_context` **sem** `completedBatchId` para criar ou retomar o checkpoint.
2. Após **cada** chamada bem-sucedida de `banca_context`, usar a ferramenta nativa `read` no caminho exato retornado em `context → <caminho>`. Não ler o manuscrito diretamente nem procurar outros arquivos.
3. Somente depois do `read`, extrair fingerprint, batchId, chunks e proveniência do context pack. Se o contexto indicar erro, plano bloqueado ou fingerprint inválido, **interromper**.
4. Se não houver próximo lote e o checkpoint estiver completo, ir ao passo 9 (síntese).
5. Analisar **todos** os chunks do lote atual. Cada finding deve ser compatível com o lote e incluir:
   - categoria
   - severidade
   - claim
   - evidence
   - arquivo público relativo
   - linhas inicial e final
   - sectionId
6. Chamar `banca_auditar` com o fingerprint e o batchId **exatos** do contexto. Enviar array vazio de findings quando nenhum finding válido existir.
7. Avançar o checkpoint **somente** após recibo bem-sucedido de `banca_auditar`. Não chame `banca_context` com `completedBatchId` se a auditoria falhou.
8. Chamar novamente `banca_context` com `completedBatchId` igual ao lote concluído. Repetir a partir do passo 2 (incluindo `read` do novo caminho) até não existir próximo lote.
9. Chamar `banca_sintese` **somente** depois que `banca_context` (e o `read` do pack) comprovar checkpoint completo e ausência de próximo lote.

Ordem lógica obrigatória:

```text
banca_context
→ read do caminho retornado
→ análise de um lote
→ banca_auditar
→ banca_context com completedBatchId
→ read do caminho retornado
→ repetir
→ banca_sintese somente após cobertura completa
```

## Findings e proveniência
- Não invente arquivo, linha, fingerprint ou batchId.
- Não persista findings fora de `banca_auditar`.
- Findings devem referir apenas trechos presentes no lote atual.

## Gate de síntese e falhas
- `banca_sintese` aparece somente após cobertura completa.
- Falha em qualquer lote impede síntese global.
- Se contexto, `read`, auditoria ou síntese retornar erro, plano bloqueado, fingerprint incompatível ou cobertura incompleta: interromper o fluxo sem gerar pontuação, aprovação, reprovação ou parecer integral.

## Formato da saída
- Durante os lotes: resumo do lote processado e findings submetidos (sem pontuação global).
- Após síntese bem-sucedida: repasse estruturado da entrada de síntese retornada por `banca_sintese`, sem inventar veredito de aprovação ou reprovação.

## Limites e nível de confiança
A análise de conteúdo depende da heurística do modelo sobre os chunks fornecidos no context pack. Contagens e findings persistidos não equivalem a validação normativa ABNT completa nem a pontuação oficial.

## Situações que exigem confirmação humana
- Plano bloqueado ou manuscrito incompleto.
- Erro de fingerprint, batchId ou cobertura incompleta que impeça progresso.
- Falha persistente de `banca_context`, `read`, `banca_auditar` ou `banca_sintese`.

## Relação com a rubrica ativa
Use a rubrica institucional apenas como orientação qualitativa dos eixos a observar nos findings. Não aplique pesos hardcoded, tetos ou travas, e não calcule pontuação global neste fluxo. Scoring permanece fora deste contrato.

## Comportamento quando as evidências forem insuficientes
Se o lote não puder ser lido via `read` do context pack, o contexto estiver bloqueado ou a auditoria falhar, interromper e sinalizar o erro. Não inferir findings inventados e não chamar `banca_sintese` com cobertura incompleta.
