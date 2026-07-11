import { existsSync, mkdirSync, cpSync, readdirSync, writeFileSync } from "node:fs"
import { join, dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const AGENTS = {
  "banca-auditor.md": `---
description: Avalia a monografia nos eixos ABNT, citações, conteúdo e estilo.
mode: subagent
permission:
  "*": deny
  skill:
    "*": deny
    banca-avaliacao: allow
  banca_context: allow
  banca_auditar: allow
  banca_status: allow
---

## Auditor de Monografia

Função: avaliar o manuscrito nos 4 eixos do *banca-rigorosa*.

### Eixos

1. **ABNT/Estrutura (peso 3)** — formatação, ficha catalográfica, elementos pré e pós-textuais
2. **Citações/Fontes (peso 3)** — cobertura de parágrafos, qualidade das referências
3. **Conteúdo/Lógica (peso 2)** — coerência metodológica, resultados, discussão
4. **Estilo Acadêmico (peso 2)** — redação, metacomentários, marcas de IA

### Comportamento

- Usa \`banca_context\` para ler o estado do projeto
- Usa \`banca_auditar\` para atualizar métricas e estado interno (não altera o manuscrito).
- Gera parecer textual por eixo\n`,
  "banca-corretor.md": `---
description: Aplica correções no manuscrito seguindo plano e contrato.
mode: subagent
permission:
  "*": deny
  skill:
    "*": deny
    banca-correcao: allow
  banca_context: allow
  banca_corrigir: allow
  banca_snapshot: allow
  banca_compile: allow
  banca_restore: allow
---

## Corretor

Aplica correções planejadas no manuscrito.

### Regras

1. Sempre criar snapshot antes de editar (\`banca_snapshot\`)
2. Sempre compilar após editar (\`banca_compile\`)
3. Nunca alterar dados primários sem confirmação
4. Preservar caminhos protegidos
5. Gerar contrato JSON das alterações

### Fluxo

1. \`banca_context\` → entender estado atual
2. \`banca_snapshot\` → backup
3. Aplicar correções com \`banca_corrigir\`
4. \`banca_compile\` → validar compilação
5. Se falhar: restaurar do snapshot com \`banca_restore\`\n`,
  "banca-fontes.md": `---
description: Valida referências e citações usando MCPs acadêmicos.
mode: subagent
permission:
  "*": deny
  skill:
    "*": deny
    banca-referencias: allow
  banca_refs: allow
  banca_context: allow
---

## Auditor de Fontes

Valida cada entrada do \`.bib\` contra bases acadêmicas.

### Fluxo

1. \`banca_refs\` → extrair referências do \`.bib\`
2. Para cada referência, chamar MCP acadêmico para validar existência e metadados
3. Calcular score de confiança (0-100)
4. Reportar referências não encontradas ou suspeitas

### Comportamento

- Depende de MCPs: crossref-academic, pubmed, openalex, semantic-scholar
- Se MCP estiver ausente, declarar limitação, não falhar\n`,
  "banca-integrador.md": `---
description: Integra pareceres dos 4 avaliadores, aplica travas e calcula nota final.
mode: subagent
permission:
  "*": deny
  skill: deny
  banca_status: allow
---

## Integrador

Consolida as notas dos 4 avaliadores e aplica as travas de nota.

### Comportamento

1. Receber notas: ABNT, Citações, Conteúdo, Estilo
2. Calcular média ponderada
3. Aplicar travas (ficha catalográfica, >30% sem citação, etc.)
4. Aplicar tetos (limites institucionais)
5. Gerar nota final e veredito\n`,
  "banca-loop.md": `---
description: Orquestra etapa assistida e preparatória do loop de correção.
mode: subagent
permission:
  "*": deny
  skill:
    "*": deny
    banca-planejador: allow
  banca_loop: allow
  banca_status: allow
  banca_context: allow
---

## Orquestrador de Loops

Coordena execução de etapa assistida e preparatória do loop de correção.

### Loops Disponíveis

| Loop | Descrição | Goal |
|------|-----------|------|
| \`correcao-continua\` | auditar → corrigir → verificar | Nota ≥ 9.0 |
| \`vigilancia-refs\` | validar referências | Score ≥ 90% |
| \`deteccao-ia\` | triagem de risco IA | Relatório por arquivo |

### Comportamento

- Executa loops FIFO (um por vez)
- Cria snapshot antes de cada iteração
- Aplica circuit breaker em oscilação/estagnação
- Alerta usuário em falhas críticas\n`,
}

const COMMANDS = {
  "banca-init.md": `---
description: Initialize banca
---

Please execute the \`banca_init\` tool to initialize the project structure. Do not run any terminal commands.\n`,
  "banca.md": `---
name: banca
description: Comandos do sistema de banca acadêmica
---

# Comandos do OpenBanca

## Comando Registrado

### \`/banca-init\`
Inicializa a estrutura \`.banca/\` no projeto utilizando a ferramenta \`banca_init\` registrada no plugin.

## Funcionalidades Futuras Planejadas

Estes comandos ainda não possuem arquivos de comando registrados no OpenCode, mas suas funcionalidades poderão ser acessadas delegando tarefas para os agentes ou futuramente por comandos diretos:

- \`/banca:status\` — Exibir estado atual do projeto.
- \`/banca:auditar\` — Executar painel de avaliação (4 avaliadores + integrador).
- \`/banca:corrigir\` — Aplicar correções com snapshot automático.
- \`/banca:refs\` — Gerar certidão de referências.
- \`/banca:ia\` — Executar triagem de risco de IA.
- \`/banca:plagio\` — Parsear relatório CopySpider.
- \`/banca:loop\` — Executar etapa assistida de preparação do loop.
- \`/banca:checklist\` — Verificar checklist de entrega.
- \`/banca:snapshot\` — Criar snapshot manual.
- \`/banca:compile\` — Compilar manuscrito LaTeX.\n`,
}

const SKILLS: Record<string, Record<string, string>> = {
  "banca-referencias": {
    "SKILL.md": `---
name: banca-referencias
description: Valida referências bibliográficas do texto contra bases de dados acadêmicas.
---
# Skill: Banca Referências

Valida referências contra bases acadêmicas.

## Quando usar
Para verificar a autenticidade e validade das referências citadas ao final de um trabalho acadêmico.

## Quando NÃO usar
Não use para avaliar a qualidade ou aderência das referências ao tema estudado, apenas sua existência factual nas bases.

## Entradas necessárias
- Caminho para o diretório ou arquivo \`.bib\` ou \`Referências\`.

## Ferramentas permitidas
- \`banca_refs\`

## Protocolo
1. Executar \`banca_refs\` para extrair a lista de referências.
2. Para cada referência extraída, tentar validação contra bases de dados externas.
3. Classificar cada referência: encontrada, não encontrada, ou suspeita.
4. Calcular o score geral de saúde das referências.
5. Gerar uma certidão formal de validação de fontes.

## Formato da saída
Um relatório Markdown em \`.banca/reports/\` com a "Certidão de Fontes" e a tabela de score.

## Limites e nível de confiança
Depende de conectividade e disponibilidade das bases de dados, mas é rigoroso para referências do tipo DOI e ISBN. Fontes antigas ou obscuras podem ser marcadas falsamente como não encontradas.

## Situações que exigem confirmação humana
Uma quantidade grande de referências não encontradas pode indicar problemas de conectividade, indisponibilidade da base de dados, ou falha no parser. O autor deve revisar manualmente e confirmar a validade.

## Relação com a rubrica ativa
Atua diretamente no Scorecard sob "Citações/Fontes", baseando as penalidades na tabela de impacto.

## Comportamento quando as evidências forem insuficientes
A referência assume estado "Suspeita" se os metadados estiverem corrompidos e nenhuma busca puder ser realizada com sucesso.
`,
  },
  "banca-revisor": {
    "SKILL.md": `---
name: banca-revisor
description: Revisa o diff das correções aplicadas para bloquear regressões e proteger dados.
---
# Skill: Banca Revisor

Revisa diff de correções e bloqueia regressão.

## Quando usar
Imediatamente após a aplicação de correções no texto, antes de consolidar ou aprovar a iteração atual.

## Quando NÃO usar
Não use para propor novas correções. A responsabilidade do revisor é apenas barrar erros.

## Entradas necessárias
- Estado atual do projeto.
- Snapshot prévio das modificações gerado pelo sistema.

## Ferramentas permitidas
\`banca_status\` para identificar arquivos modificados. Avaliação majoritariamente conduzida por leitura visual de diff no contexto.

## Protocolo
1. Comparar o diff gerado entre o último snapshot estável e o estado atual modificado.
2. Checar contra restrições rígidas:
   - Nenhum dado imutável deve ter sido alterado.
   - Nenhuma citação pode ter sido removida sem que uma substituta válida fosse adicionada.
   - Nenhum arquivo/caminho protegido deve ter sido modificado.
   - O projeto deve compilar com sucesso.
3. Se regressão detectada: rejeitar o diff e sugerir rollback.

## Formato da saída
Aprovação silenciosa em log ou erro claro de "Bloqueio" rejeitando a última iteração, com instruções para restauração.

## Limites e nível de confiança
Comportamento conservador e focada em sinalização de risco para chamar a atenção do usuário perante deleções suspeitas.

## Situações que exigem confirmação humana
Bloqueio contínuo do revisor (ciclo travado), onde a intervenção manual deve ignorar a revisão ou corrigir os dados de raiz.

## Relação com a rubrica ativa
Atua como camada de segurança para alertar sobre possível perda de nota ou degradação na iteração atual.

## Comportamento quando as evidências forem insuficientes
Se não houver snapshot anterior válido, o revisor passa sem bloquear, gerando um aviso sobre o pulo do fluxo de segurança.

## Critérios de Bloqueio Ativos
- Score caiu → bloqueio imediato.
- Dado imutável alterado → bloqueio imediato.
- Citação removida sem substituta → bloqueio.
- Remoção abrupta (>20 linhas) sem justificativa clara → alerta, passível de bloqueio.
`,
  },
  "banca-correcao": {
    "SKILL.md": `---
name: banca-correcao
description: Aplica correções no manuscrito utilizando snapshots e validação de compilação.
---
# Skill: Banca Correção

Aplica correções no manuscrito com snapshot, contrato e validação.

## Quando usar
Para aplicar modificações recomendadas ao código-fonte ou texto do projeto, especialmente após uma rodada de avaliação ou planejamento.

## Quando NÃO usar
Não use para reescrever capítulos inteiros sem aprovação prévia. Não use para formatar dados estatísticos ou resultados experimentais primários.

## Entradas necessárias
- Relatório de auditoria prévio.
- Plano de correções estruturado.

## Ferramentas permitidas
- \`banca_snapshot\`
- \`banca_corrigir\`
- \`banca_compile\`

## Protocolo
1. Carregar relatório de auditoria e plano.
2. Classificar cada achado (Auto, Entrevistar, Pular) usando a Matriz de Decisão.
3. Criar um snapshot de segurança com \`banca_snapshot\`.
4. Aplicar as correções com \`banca_corrigir\`.
5. Compilar para verificar a estabilidade com \`banca_compile\`.
6. Revisar o diff e atualizar o scorecard.

## Formato da saída
Alterações diretas nos arquivos e atualização do histórico de correções em \`.banca/\`.

## Limites e nível de confiança
Snapshots fornecem segurança permitindo a reversão de mudanças caso ocorram falhas, mas as compilações e re-auditorias são fundamentais para confirmar a ausência de regressões.

## Situações que exigem confirmação humana
- Confiança baixa e impacto alto para a correção.
- Alterações em caminhos protegidos ou seções que exigem revisão (Matriz de Decisão).

## Relação com a rubrica ativa
Atua para elevar o score nas dimensões em defasagem apontadas pelo scorecard, focando na conformidade ABNT e estrutural.

## Comportamento quando as evidências forem insuficientes
Em caso de falta de certeza sobre a correção, falhar para a categoria "Entrevistar" e não aplicar a alteração diretamente.

## Imutáveis (Guardrails)
- Dados experimentais primários.
- Resultados estatísticos.
- Identificadores (CEUA, DOI).
- Caminhos protegidos e seções blindadas.
`,
  },
  "banca-avaliacao": {
    "SKILL.md": `---
name: banca-avaliacao
description: Avalia monografias nos eixos ABNT, citações, conteúdo e estilo para nota final.
---
# Skill: Banca Avaliação

Avalia monografias nos eixos ABNT, citações, conteúdo e estilo.

## Quando usar
Sempre que for necessário gerar um relatório completo de avaliação de um documento ou obter métricas objetivas de sua qualidade técnica.

## Quando NÃO usar
Não use para aplicar correções diretas no texto. Não use para triagem exclusiva de IA sem análise de conteúdo.

## Entradas necessárias
- Caminho para o diretório ou arquivo alvo.
- Contexto ativo da monografia ou documento.

## Ferramentas permitidas
- \`banca_auditar\`
- \`banca_context\`

## Protocolo
1. Carregar contexto via \`banca_context\`.
2. Executar \`banca_auditar\` para extrair métricas objetivas.
3. Avaliar cada eixo com base no contexto e nas métricas levantadas.
4. Gerar parecer textual por eixo.
5. Delegar ao integrador para compilação da nota final.

## Formato da saída
Parecer textual estruturado em Markdown. O relatório será salvo em disco apenas se o comando ativo possuir protocolo explícito com \`save: true\`.

## Limites e nível de confiança
A avaliação de conteúdo e estilo acadêmico depende da heurística do modelo. Confiança limitada/média: as contagens objetivas servem de base, mas não equivalem a uma validação normativa ABNT completa e infalível.

## Situações que exigem confirmação humana
- Nota sugerida abaixo de 4.0 por problemas estruturais severos.
- Identificação de falha grave na compilação do relatório.

## Relação com a rubrica ativa
Perfil: \`banca-rigorosa\`
- ABNT/Estrutura: peso 3
- Citações/Fontes: peso 3
- Conteúdo/Lógica: peso 2
- Estilo Acadêmico: peso 2
- Travas ativas:
  - >30% parágrafos sem citação → nota máxima 4.0
  - Ficha catalográfica caseira (sem CRB) → nota máxima 6.0
  - Conclusão rotulada de forma incorreta → nota máxima 6.0

## Comportamento quando as evidências forem insuficientes
Se a contagem não puder ser realizada com \`banca_auditar\` ou o contexto estiver vazio, interromper e sinalizar erro grave. Não inferir notas sem dados base.
`,
  },
  "banca-plagio": {
    "SKILL.md": `---
name: banca-plagio
description: Interpreta relatórios CopySpider e reescreve trechos de texto problemáticos.
---
# Skill: Banca Plágio

Parseia relatórios CopySpider e reescreve trechos problemáticos.

## Quando usar
Para lidar com relatórios de plágio e reescrever partes do texto marcadas com similaridade excessiva.

## Quando NÃO usar
Não use para gerar texto novo do zero ou substituir citações diretas legítimas.

## Entradas necessárias
- Caminho para o arquivo PDF ou HTML do relatório do CopySpider.

## Ferramentas permitidas
- \`banca_plagio\`
- \`banca_snapshot\`, \`banca_corrigir\` e \`banca_compile\` para aplicar edições com segurança.

## Protocolo
1. Parsear o relatório CopySpider fornecido.
2. Identificar fontes com similaridade Geral (Sg) no nível Moderado ou Alto.
3. Mapear n-gramas do relatório contra os capítulos do texto original.
4. Classificar ações para cada trecho: PULAR, REESCREVER ou ENTREVISTAR.
5. Reescrever as seções mantendo os imutáveis intactos.
6. Validar compilação do projeto a cada bloco modificado.
7. Arquivar o relatório original no registro do projeto.

## Formato da saída
Arquivos do projeto atualizados com texto reescrito. Logs das modificações.

## Limites e nível de confiança
A reescrita de texto sem perda semântica tem nível de confiança médio/alto, mas a skill não entende citações mal formatadas inerentemente sem o relatório ABNT prévio.

## Situações que exigem confirmação humana
Trechos com similaridade muito alta, sem fontes associadas e extensos demais para serem apenas reescritos sem risco de perda de significado.

## Relação com a rubrica ativa
Reduz a penalidade no eixo Citações/Fontes caso seja um erro de transcrição não citada.

## Comportamento quando as evidências forem insuficientes
Se o relatório for ilegível, deve reportar falha no parser sem alterar nenhum arquivo.

## Imutáveis (Guardrails)
- Nomes de instituições e órgãos públicos.
- Variáveis, constantes e dados matemáticos.
- Citações já devidamente referenciadas.
- Resultados estatísticos.
`,
  },
  "banca-detector-ia": {
    "SKILL.md": `---
name: banca-detector-ia
description: Analisa padrões estilísticos sinalizados pela heurística interna e produz uma triagem não conclusiva, sem determinar autoria por IA.
---
# Skill: Banca Detector IA

Triagem de risco de texto gerado por IA.

## Quando usar
Para analisar suspeitas de geração por IA em trechos sinalizados, aplicando uma heurística de padrões linguísticos repetitivos.

## Quando NÃO usar
Nunca use para emitir laudos conclusivos sobre autoria ou uso de IA, nem como justificativa primária para reprovação.

## Entradas necessárias
- Caminho para o diretório alvo.

## Ferramentas permitidas
- \`banca_ia\`

## Protocolo
1. Executar \`banca_ia\` para scan heurístico do diretório.
2. Para análise profunda: combinar a execução com ensemble opcional.
3. Combinar scores heurísticos gerados e formatar o diagnóstico.
4. Gerar relatório contendo níveis de risco e evidências identificadas.

## Formato da saída
Relatório em Markdown com Risco (baixo/moderado/alto), Confiança (0-100) e listagem de trechos por arquivo.

## Limites e nível de confiança
A confiança é inerentemente baixa. A heurística baseia-se em vocabulário comum de LLMs e previsibilidade de n-gramas, que também ocorrem em texto humano.

## Situações que exigem confirmação humana
O relatório final sempre exige análise do orientador/banca para qualquer tomada de decisão. A skill nunca pune automaticamente.

## Relação com a rubrica ativa
O relatório pode ser anexado como evidência extra ao avaliador humano, mas não afeta automaticamente o Scorecard técnico.

## Comportamento quando as evidências forem insuficientes
Se o documento for curto demais, deve reportar "Evidência Insuficiente" sem atribuir classificação de risco.
`,
  },
  "banca-grille": {
    "SKILL.md": `---
name: banca-grille
description: Executa entrevista com o usuário antes de aplicar correções complexas ou ambíguas.
---
# Skill: Banca Grille

Entrevista exaustiva com usuário antes de executar correções complexas.

## Quando usar
Sempre que uma correção proposta esbarrar na Matriz de Decisão sob a categoria "Entrevistar" (alto risco, ambiguidade ou caminhos restritos).

## Quando NÃO usar
Não use para correções triviais (ex.: erros de digitação simples ou espaços em branco).

## Entradas necessárias
- Contexto do achado a ser corrigido.

## Ferramentas permitidas
Esta skill atua exclusivamente através da comunicação textual com o usuário para clarificação. Não executa ferramentas nem altera arquivos diretamente.

## Protocolo
1. Apresentar contexto do achado apontado na auditoria ou revisão.
2. Perguntar ao usuário de forma objetiva sobre:
   - Escopo: quais arquivos ou seções devem ser corrigidos?
   - Imutáveis: o que NÃO pode ser alterado no texto em questão?
   - Tolerância: qual é a nota alvo ou limite aceitável de refatoração?
3. Salvar respostas no contexto da iteração atual.
4. Só prosseguir para a próxima etapa quando todas as respostas forem esclarecidas.

## Formato da saída
Repasse de contexto claro e estruturado para o agente/skill solicitante.

## Limites e nível de confiança
Alta confiança por tratar-se de confirmação direta com o autor (human-in-the-loop).

## Situações que exigem confirmação humana
A natureza desta skill é inteiramente baseada em interação humana.

## Relação com a rubrica ativa
Atua como um filtro de segurança para não comprometer o projeto antes de aplicar regras estritas de nota.

## Comportamento quando as evidências forem insuficientes
Perguntar novamente ao usuário ou solicitar arquivos adicionais para fornecer melhor contexto ao problema.
`,
  },
  "banca-planejador": {
    "SKILL.md": `---
name: banca-planejador
description: Define o plano de correção otimizado para a próxima iteração do loop.
---
# Skill: Banca Planejador

Define plano de correção para iteração do loop.

## Quando usar
No início de uma rodada de iteração, após a auditoria, para criar um plano acionável para o agente corretor.

## Quando NÃO usar
Não use diretamente como corretor. A skill não deve alterar arquivos de código fonte ou manuscritos do projeto principal, apenas documentos de planejamento.

## Entradas necessárias
- Context pack atualizado (via \`banca_context\`).
- Relatório de auditoria contendo as deficiências.
- Histórico de iterações anteriores.

## Ferramentas permitidas
A skill produz orientação textual e planejamento. Pode requerer leitura do histórico se fornecido no contexto, mas não grava arquivos diretamente.

## Protocolo
1. Analisar as dependências entre os problemas apontados na auditoria.
2. Priorizar achados críticos (como travas que limitam a nota a 4.0 ou 6.0).
3. Elaborar uma estratégia priorizando a adição de citação sobre a remoção de texto e mantendo intocáveis os imutáveis.
4. Restringir o escopo para um máximo de 10 correções planejadas por iteração, evitando instabilidade.
5. Produzir o artefato final.

## Formato da saída
- Plano em Markdown descrevendo a estratégia.
- Objeto ou lista estruturada para repasse ao executor da correção.

## Limites e nível de confiança
Confiança alta para o planejamento lógico; a implementação prática recairá sobre \`banca-correcao\`.

## Situações que exigem confirmação humana
Se o número de problemas críticos for gigantesco a ponto de exigir refatoração total da estrutura do TCC.

## Relação com a rubrica ativa
Usa os pesos da rubrica ativa para priorizar os problemas de maior impacto no score final.

## Comportamento quando as evidências forem insuficientes
Planejar iteração vazia, avisando o usuário que não há correções necessárias ou que os dados da auditoria não puderam ser lidos.
`,
  },
}

const TEMPLATES: Record<string, string> = {
  "scorecard.md": `# Scorecard\n\n| Dimensão | Nota |\n|----------|------|\n| ABNT/Estrutura | 0.0 |\n| Citações/Fontes | 0.0 |\n| Conteúdo/Lógica | 0.0 |\n| Estilo Acadêmico | 0.0 |\n| **Final** | **0.0** |\n`,
  "iterations.md": `# Iterações\n\n| Data | Nota | Ação | Status |\n|------|------|------|--------|\n`,
  "checklist.md": `# Checklist\n\n- [ ] Formatação ABNT\n- [ ] Ficha catalográfica\n- [ ] Resumo/Abstract\n- [ ] Sumário\n- [ ] Lista de figuras\n- [ ] Lista de tabelas\n- [ ] Referências\n`,
  "knowledge.md": `# Base de Conhecimento\n\n`,
}

function getFilesRecursively(dir: string): string[] {
  const results: string[] = []
  if (!existsSync(dir)) return results
  const list = readdirSync(dir, { withFileTypes: true })
  for (const file of list) {
    const res = join(dir, file.name)
    if (file.isDirectory()) {
      results.push(...getFilesRecursively(res))
    } else {
      results.push(res)
    }
  }
  return results
}

function copyDirectory(src: string, dest: string, force: boolean, installed: string[]) {
  if (!existsSync(src)) return
  const files = getFilesRecursively(src)
  for (const file of files) {
    const rel = relative(src, file)
    const destPath = join(dest, rel)
    const destDir = dirname(destPath)
    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true })
    if (!existsSync(destPath) || force) {
      cpSync(file, destPath)
      installed.push(destPath)
    }
  }
}

export function installAssets(projectRoot: string, force: boolean, customAssetsDir?: string): string[] {
  const installed: string[] = []

  function write(path: string, content: string) {
    const dir = dirname(path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    if (!existsSync(path) || force) {
      writeFileSync(path, content, "utf-8")
      installed.push(path)
    }
  }

  const pluginAssetsDir = customAssetsDir || join(__dirname, "..", "..", "assets")

  if (existsSync(pluginAssetsDir)) {
    // Install versioned agents
    copyDirectory(join(pluginAssetsDir, "opencode", "agents"), join(projectRoot, ".opencode", "agents"), force, installed)
    
    // Install versioned commands
    copyDirectory(join(pluginAssetsDir, "opencode", "commands"), join(projectRoot, ".opencode", "commands"), force, installed)
    
    // Install versioned skills
    copyDirectory(join(pluginAssetsDir, "opencode", "skills"), join(projectRoot, ".opencode", "skills"), force, installed)
    
    // Install versioned templates
    copyDirectory(join(pluginAssetsDir, "templates"), join(projectRoot, ".banca"), force, installed)
  } else {
    // Fallback agents
    for (const [name, content] of Object.entries(AGENTS)) {
      write(join(projectRoot, ".opencode", "agents", name), content)
    }

    // Fallback commands
    for (const [name, content] of Object.entries(COMMANDS)) {
      write(join(projectRoot, ".opencode", "commands", name), content)
    }

    // Fallback skills
    for (const [skillName, files] of Object.entries(SKILLS)) {
      for (const [fileName, content] of Object.entries(files)) {
        write(join(projectRoot, ".opencode", "skills", skillName, fileName), content)
      }
    }
  }

  // Ensure default templates exist (write them if not already copied from versioned folder)
  for (const [name, content] of Object.entries(TEMPLATES)) {
    const destPath = join(projectRoot, ".banca", name)
    // Check if it was already installed via versioned copy
    if (!installed.includes(destPath)) {
      write(destPath, content)
    }
  }

  return installed
}
