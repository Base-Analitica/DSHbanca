# Fluxo operacional para agentes de IA no terminal

## Objetivo e autoridade

Este procedimento aplica-se a qualquer agente de terminal que inspecione, implemente, teste ou prepare mudanças no repositório DSHbanca. O produto é exclusivamente um plugin acadêmico para DSH, composto pelo host por meio de Cordis. Não use outro harness, fallback ou cliente como caminho de execução do produto.

Este manual complementa `AGENTS.md`, não o substitui. Leia também, conforme o escopo:

| Situação | Leitura obrigatória |
|---|---|
| Revisão de código | `docs/ai-review-protocol.md`, tratando como dívida qualquer critério contraditório sobre harness ou compatibilidade |
| Alterar issue, prioridade ou labels | `docs/issue-labeling-policy.md` e `.github/labels.yml` |
| Mudança em integração DSH | `docs/architecture.md`, `package.json`, `cordis.patch.yml`, entrypoint e API DSH instalada |
| Executar validação | `package.json`, `.github/workflows/ci.yml`, testes e scripts envolvidos |
| E2E DSH do perfil | `docs/dsh-profile-e2e.md`, se estiver disponível no checkout e a tarefa solicitar ou depender desse gate |
| Criar PR | `CONTRIBUTING.md` e `.github/PULL_REQUEST_TEMPLATE.md`, se disponíveis |

O contrato explícito da issue/PR determina escopo, arquivos permitidos, base, critérios e operações autorizadas. Código e execução no SHA real prevalecem sobre intenção, comentários, planos e arquivos presentes sem discovery comprovada.

## 1. Preflight de Git e preservação do trabalho

Antes de editar, resolva a base autorizada pela issue ou metadata da PR. Use `origin/master` como padrão somente quando isso estiver autorizado.

```bash
git status --short --branch
git branch --show-current
git fetch origin --prune
BASE_REF=origin/master
git rev-parse HEAD
git rev-parse "$BASE_REF"
git merge-base HEAD "$BASE_REF"
node --version
bun --version
```

Registre branch, SHA inicial, base e SHA da base, merge-base, versões relevantes e todas as alterações locais preexistentes. Preserve arquivos staged, unstaged e untracked que não pertençam à tarefa.

- Se o contrato indicar branch/PR existente, continue nela e não crie duplicata.
- Para tarefa nova, verifique antes duplicatas de issue, branch e PR. Crie uma única branch baseada no remoto autorizado.
- Use worktree separado quando a árvore atual tiver trabalho não relacionado ou quando a troca de branch puder alterá-lo.
- Não use `git reset --hard`, `git clean -fd`, restore destrutivo, rebase interativo, force-push ou push na branch padrão como procedimento normal.
- Não use `git add -A` quando houver arquivos fora do escopo. Adicione somente os caminhos autorizados.

## 2. Preflight host-first para DSH/Cordis

Antes de alterar qualquer integração ou alegar suporte, inspecione a instalação efetivamente testada. Registre versão do DSH, Cordis, loader e de cada pacote DSH usado. Não trate versão encontrada em documentação como versão instalada.

Verifique as assinaturas públicas utilizadas no código e responda:

1. Qual entrypoint do plugin e qual configuração Cordis carregam a integração?
2. Quais serviços/injeções DSH são solicitados e quais estão montados no perfil real?
3. Como os registradores de tools, guards, skills ou agentes são chamados na versão instalada?
4. Quem cria e descarta recursos, agentes e sessões? Qual é o owner de cada lifecycle?
5. Como a identidade do preset chega ao dispatch da ferramenta? Qual valor foi produzido/validado pelo host, e não fabricado pelo teste?
6. Em qual fase os guards são executados relativamente ao corpo da ferramenta? Como sua remoção acompanha o lifecycle Cordis?
7. Qual configuração, credenciais e atividade externa são necessárias? O teste pode operar sem modelo e sem credenciais?
8. Qual evidência demonstra discovery, composição, dispatch e teardown no DSH real?

Use nomes de API somente após encontrá-los em types, implementação ou documentação da versão instalada. Se o host não expuser o contrato requerido, ou se o ambiente não permitir verificá-lo, classifique `BLOCKED` e pare a implementação dependente. Não crie outro controller de sessão, permission engine, executor, registry ou harness para contornar a lacuna.

Cada integração deve identificar seu owner de lifecycle, ambiente, credenciais, fallback, riscos e evidência no SHA. Um fallback que viole o DSH-only não é permitido.

### Discovery não é execução

Diferencie explicitamente as etapas:

1. arquivo fonte incluído no pacote;
2. arquivo instalado no workspace;
3. plugin e extensão descobertos pelo DSH;
4. tool/skill/preset associado pela API nativa;
5. Agent ou sessão real recebendo a identidade/conteúdo esperado;
6. dispatch executado no host;
7. comportamento dependente de modelo observado, apenas se expressamente autorizado.

Arquivos em disco, hash coincidente, objeto de contexto montado à mão, nome de preset, fixture de composição vazia ou teste mockado não provam as etapas seguintes. Um E2E sem modelo pode comprovar somente o que ele observa no host. Não declare que o modelo recebeu ou seguiu Markdown sem evidência dessa projeção e, quando necessário, teste de modelo autorizado.

## 3. Segurança de identidade e mutações acadêmicas

Para qualquer alteração ou teste do auditor/corretor:

- mantenha `banca-auditor` read-only e preserve o enforcement nativo já comprovado;
- não conceda permissões para facilitar o teste;
- use identidade efetivamente produzida/verificada pelo DSH;
- tente mutações com argumentos válidos e confirme negação anterior ao corpo;
- diferencie negação de erro de argumento, arquivo ausente, abort ou falha incidental;
- valide hashes relativos do manuscrito, estado persistente e snapshots antes/depois;
- teste que a ferramenta permitida continua funcionando e que delegação sem preset corretor verificado falha fechada;
- descarte AgentHandle, listeners, guardas e sandbox conforme API observada e reporte teardown.

Texto de instrução não é controle de acesso. Mudanças em trust model, permissões, papel do Markdown, scoring, rubricas ou critério acadêmico exigem decisão humana registrada. Não execute correção, restore destrutivo ou parecer acadêmico fora do escopo autorizado.

## 4. Segredos, modelos e dados

Nunca execute comandos que despejem o ambiente inteiro nem leia conteúdo de arquivos de credenciais. Não imprima, versione ou inclua em relatório tokens, API keys, senha, cookies, conteúdo de `.env`, manuscritos reais, dados pessoais ou caminhos privados desnecessários.

O comportamento padrão é não enviar prompt, não chamar `Agent.send` ou `session.prompt`, não autenticar em provedor e não incorrer em custo. Teste com modelo exige autorização humana específica, identificação do modelo, finalidade, teto de custo, isolamento e política de dados. Um teste CLI sem inferência não comprova comportamento de modelo.

Antes de qualquer suíte ou script, leia sua implementação e trace os subprocessos, configurações, resolução de executável, rede e variáveis herdadas. Uma variável de opt-in não é autorização do usuário. Só execute um caminho externo se a issue permitir e a segurança estiver demonstrada.

## 5. Estratégia RED/GREEN e validação

Para mudança funcional, reproduza primeiro o defeito ou crie teste de regressão que falhe por motivo observável. Registre o teste RED e a causa. Implemente a menor mudança DSH-native. Repita o mesmo teste em GREEN e execute novamente os casos negativos, limites e teardown no HEAD final. Mudança documental não deve inventar reprodução funcional.

Descubra comandos reais em `package.json`, CI, scripts e contrato da issue. Não suponha que um comando seja seguro pelo nome. O CI convencional pode compilar e testar lógica sem iniciar o DSH, não autenticar provedor e não provar integração nativa.

Na base consultada para issue #5, `package.json` e `.github/workflows/ci.yml` incluem `bun test`; o pacote também conserva o runner legado `e2e:opencode`. Inspecione `tests/e2e-opencode.test.ts`, o runner importado e o ambiente antes da suíte completa. Só execute `bun test` se estiver demonstrado que credenciais, configuração pessoal e executável externo não são alcançáveis. Prefira um ambiente temporário com HOME e PATH isolados e sem variáveis de credencial. Caso não seja possível comprovar esse isolamento, não rode a suíte inteira e registre `BLOCKED`, causa e testes seguros alternativos. Não afrouxe gates para forçar um resultado verde.

A cada gate, registre comando exato e exit code. Use:

- `PASS`: o comportamento exigido foi realmente executado e observado;
- `FAIL`: o teste foi executado e o resultado não satisfez o critério;
- `BLOCKED`: não executado ou inconclusivo por restrição concreta.

Níveis de evidência que não devem ser confundidos:

| Evidência | Limite |
|---|---|
| Inspeção de código, diff ou configuração | Não comprova comportamento em runtime. |
| Typecheck/build | Não comprova correção funcional nem discovery. |
| Unitário, fixture ou mock | Não comprova DSH/Cordis real. |
| E2E DSH sem modelo | Prova somente discovery, lifecycle, identidade, dispatch ou enforcement que foram diretamente observados. |
| E2E com modelo | Prova comportamento dependente do modelo apenas naquela configuração e execução autorizada. |
| CI verde | Não transforma teste unitário em E2E DSH ou teste de modelo. |

Quando o critério exigir integração, execute o E2E DSH real no SHA final e em checkout limpo, se provisionado e autorizado. Não use artefato de um SHA anterior como prova do HEAD final. Preserve, sanitize e vincule relatório JSON com versões, revisão, status de limpeza, etapas observadas, checks de segurança, hashes relativos quando pertinentes, exit codes e teardown. Não grave credenciais nem caminhos privados.

## 6. Revisão e publicação

Antes de commit:

```bash
git status --short --branch
git --no-pager diff --check
git --no-pager diff --stat
git --no-pager diff
```

Confirme escopo e stage explícito:

```bash
git add <arquivos-autorizados>
git status --short
git --no-pager diff --cached
```

Após commit, revise o range integral da entrega contra a base autorizada:

```bash
BASE_REF=origin/master
git fetch origin --prune
git --no-pager diff --check "$BASE_REF"...HEAD
git --no-pager diff --stat "$BASE_REF"...HEAD
git --no-pager diff --name-only "$BASE_REF"...HEAD
git --no-pager diff "$BASE_REF"...HEAD
```

Verifique que apenas os arquivos permitidos aparecem, que não há alterações de terceiros no commit e que a branch/base correspondem ao contrato. Publique somente na branch autorizada, sem force-push. Abra ou atualize somente a PR prevista. Mantenha draft e não faça merge, release ou marque pronta sem autorização.

## 7. Relatório final obrigatório

Registre:

1. issue, PR e escopo autorizado;
2. branch, SHA inicial, base/SHA da base, merge-base e SHA final;
3. alterações locais preexistentes e como foram preservadas;
4. arquivos alterados e verificação do diff completo;
5. versões DSH/Cordis/pacotes realmente consultadas, APIs e assinaturas verificadas;
6. resultado RED/GREEN ou motivo de não aplicabilidade;
7. cada gate com comando, exit code, `PASS`, `FAIL` ou `BLOCKED` e evidência;
8. E2E DSH real executado ou não executado, URL do artefato e limitações;
9. modelo, credenciais, rede, dados acadêmicos e custo: utilizados ou não, sem revelar segredos;
10. CI do SHA final, dívida restante e dependência para revisão humana.

Não declare integração DSH, descoberta de skill/preset, carregamento Markdown, enforcement, uso de modelo ou resultado acadêmico sem a prova correspondente. Se qualquer critério de aceite permanecer não validado, diga precisamente o que falta e deixe o aceite para o mantenedor.
