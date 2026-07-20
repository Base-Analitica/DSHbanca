---
name: banca
description: Comandos do sistema de banca acadêmica
---

# Comandos do OpenBanca

## Comandos Registrados

### `/banca-init`
Inicializa a estrutura `.banca/` no projeto utilizando a ferramenta `banca_init` registrada no plugin.

### `/banca-auditar`
Executa a auditoria acadêmica exaustiva do manuscrito invocando o subagent `banca-auditor` (skill `banca-avaliacao`). Não altera o manuscrito e não emite veredito institucional nem pontuação global.

## Funcionalidades Futuras Planejadas

Estes comandos ainda não possuem arquivos de comando registrados no OpenCode, mas suas funcionalidades poderão ser acessadas delegando tarefas para os agentes ou futuramente por comandos diretos:

- `/banca:status` — Exibir estado atual do projeto.
- `/banca:corrigir` — Aplicar correções com snapshot automático.
- `/banca:refs` — Gerar certidão de referências.
- `/banca:ia` — Executar triagem de risco de IA.
- `/banca:plagio` — Parsear relatório CopySpider.
- `/banca:loop` — Executar etapa assistida de preparação do loop.
- `/banca:checklist` — Verificar checklist de entrega.
- `/banca:snapshot` — Criar snapshot manual.
- `/banca:compile` — Compilar manuscrito LaTeX.
