---
name: banca
description: Comandos do sistema de banca acadêmica
---

# Comandos `/banca:*`

## `/banca:init`
Inicializa estrutura `.banca/` no projeto.

Flags:
- `--force` sobrescreve config existente

## `/banca:status`
Exibe estado atual do projeto.

## `/banca:auditar`
Executa painel de avaliação (4 avaliadores + integrador).

## `/banca:corrigir`
Aplica correções com snapshot automático.

Flags:
- `--file <path>` especifica arquivo alvo
- `--old <text>` texto a substituir
- `--new <text>` novo texto
- `--score <n>` nota anterior (valida regressão)

## `/banca:refs`
Gera certidão de referências.

## `/banca:ia`
Executa triagem de risco de IA.

## `/banca:plagio <report-path>`
Parseia relatório CopySpider.

## `/banca:loop <loop-name>`
Executa loop de correção contínua.

## `/banca:checklist`
Verifica checklist de entrega.

## `/banca:snapshot`
Cria snapshot manual.

## `/banca:compile`
Compila manuscrito LaTeX.
