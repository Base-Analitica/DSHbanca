# Skill: Banca Plágio

Parseia relatórios CopySpider e reescreve trechos problemáticos.

## Ativação

Invocar agente ou via `/banca:plagio <report-path>`.

## Protocolo

1. Parsear relatório CopySpider (PDF)
2. Identificar fontes com Sg = Moderado/Alto
3. Mapear n-gramas contra capítulos
4. Classificar: PULAR / REESCREVER / ENTREVISTAR
5. Reescrever preservando imutáveis
6. Validar compilação após cada bloco
7. Arquivar relatório original

## Imutáveis

- Nomes de instituições
- Variáveis e dados
- Citações e referências
- Resultados estatísticos
