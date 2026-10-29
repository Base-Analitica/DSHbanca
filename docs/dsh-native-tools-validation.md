# Correção do registro nativo de ferramentas DSH

## Escopo e preflight

- Branch: `fix/dsh-native-tools` (nova; nenhuma branch da tarefa preexistente).
- SHA inicial: `be4453a9d2b4b42a8c53567e32d8bc39def92d89`. O SHA final e a URL da PR são registrados na descrição da PR para evitar autorreferência do commit.
- Publicação solicitada pelo mantenedor: branch dedicada e PR draft, sem merge na base.
- Base autorizada: `origin/master`; SHA e merge-base iguais ao SHA inicial acima após fetch.
- Node `v26.7.0`; Bun `1.4.2`. Working tree inicialmente limpo.
- Arquivos da entrega: `CHANGELOG.md`, `package.json`, `src/dsh.ts`, `src/index.ts`, `src/lib/tools.ts`, `tests/dsh.test.ts`, `tests/banca_sintese.test.ts` e este relatório. O range `origin/master...HEAD` é revisado após o commit.

## Diagnóstico e implementação

A regressão falhou inicialmente com zero ferramentas, contra 16 esperadas.
A entrada nativa agora injeta `tools` e registra as 16 definições acadêmicas.
O catálogo compartilhado mantém a integração OpenCode sem duplicar ferramentas.
O teste OpenCode que procurava strings no arquivo de entrada foi atualizado para
validar o catálogo efetivamente retornado pelo plugin (as mesmas 16 ferramentas).
Schemas JSON são derivados do Zod já instalado; execução valida os argumentos,
propaga o sinal de cancelamento e resolve projectRoot relativo ao cwd da sessão.
Resultados textuais têm contrato de saída e renderização nativos, inclusive PTC.

O build empacota apenas o catálogo em `dist/lib/tools.js`: o código legado
usa imports sem extensão, incompatíveis com Node ESM puro. Manter esse bundle
em `dist/lib` também preserva a resolução dos assets por import.meta.url.
O teste verifica a instalação do template versionado style-guide, evitando uma
queda silenciosa no fallback. A entrada DSH permanece em `dist/dsh.js`,
preservando a localização das skills.

## Preflight host-first

1. OpenCode já fornece registro/execução via Plugin.tool; isso continua sendo usado.
2. APIs verificadas: Plugin/ToolDefinition do SDK instalado, tools.register,
   ToolRuntime.execute e contrato ToolDefinition do DSH 0.2.0-rc.2 instalado.
3. Lacuna concreta: a entrada dshbanca/dsh já carregada não publica Plugin.tool
   no registro do DSH; não é lacuna de modelos, permissões ou tool loop.
4. Esta adaptação publica somente as ferramentas acadêmicas existentes.
5. Não cria sessão, processo, cliente MCP, permission engine nem executor geral.
6. Não há E2E OpenCode que demonstre a necessidade de outro harness: a mudança
   atende ao pedido explícito de corrigir a integração DSH já existente. O teste
   comportamental OpenCode falha também na base isolada (status 1).
7. Se o host oferecer carregamento nativo destas ToolDefinitions, remover a
   adaptação de registro/schema e manter apenas o catálogo acadêmico.

Lifecycle, ambiente, credenciais e aprovação pertencem ao host. O plugin não
adiciona credenciais ou fallback de execução; ausência de workspace e projectRoot
é erro. O fallback de assets preexistente não foi alterado.

## Evidência e limites

- PASS: regressão vermelha/verde do entry indicado pelo patch real do bundle,
  importado em subprocesso Node, com as 16 ferramentas, schemas aninhados,
  obrigatoriedade, skills, validação, cancelamento e execução de banca_context.
- PASS: mesma regressão com ToolRuntime e SystemPrompt reais do DSH instalado,
  incluindo despacho e rejeição de argumentos inválidos pelo pipeline nativo.
  Usa identidade de sessão sintética, não um modelo ou GUI.
- PASS (exit 0): build, typecheck, scripts/validate.sh (inclui skills/agentes),
  scripts/check-secrets.sh --ci e git diff --check.
- FAIL (exit 1): suíte completa, 589 pass / 1 fail; teste
  `real OpenCode: contaminated host config does not load global plugin; local banca_init completes`,
  em tests/e2e-opencode.test.ts:1743 (status esperado 0, observado 1).
  Reproduzido isoladamente e na base original extraída por git archive, sem a correção.
  Não atribuí causa a autenticação/modelo sem evidência.
- Não executados nesta validação local: sessão com LLM no DSH, GUI recarregada e CI remoto. O estado do CI posterior à publicação deve ser consultado na PR.
  Nenhuma reinstalação, alteração do perfil ou reinicialização do host foi feita.
- Review independente detectou o risco de assets ao empacotar tudo na raiz;
  corrigido empacotando o catálogo no mesmo nível de lib e coberto por regressão.

Reprodução com runtime real (ajuste o caminho para sua instalação):

```sh
DSH_TEST_HOST_PACKAGE=/caminho/absoluto/dsh/package.json bun test tests/dsh.test.ts
```

Sem a variável, o teste mantém a verificação portátil do bundle e das ferramentas
com registradores instrumentados, sem exigir DSH como dependência deste pacote.
