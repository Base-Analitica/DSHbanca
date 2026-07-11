---
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
- `banca_plagio`
- `banca_snapshot`, `banca_corrigir` e `banca_compile` para aplicar edições com segurança.

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
