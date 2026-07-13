# Fluxo de Trabalho para Agentes de IA no Terminal

## Objetivo

Este documento define o procedimento operacional para qualquer agente de IA usado no terminal para inspecionar, implementar, testar ou preparar mudanças no OpenBanca.

O manual é **independente de fornecedor**. O nome da ferramenta CLI não altera as regras do repositório. Não crie arquivos, pastas ou procedimentos específicos por fornecedor; use este fluxo e a governança do repositório.

Este documento **complementa, mas não substitui** a governança existente. A fonte principal de governança é `AGENTS.md`. Consulte os protocolos especializados conforme o tipo de tarefa:

Para a regra arquitetural host-first, leia a seção **Invariante arquitetural: OpenCode é o harness** do `AGENTS.md` e a divisão conceitual em `docs/architecture.md`. Antes de criar cliente, adapter, runtime, servidor ou integração, registre no relatório as respostas do preflight: capacidade do OpenCode e API/configuração verificada, lacuna concreta, justificativa acadêmica, limite de escopo, evidência E2E real e plano de remoção/migração. A regra foi consolidada nas issues [#64](https://github.com/RenyEnnos/openbanca/issues/64) e [#65](https://github.com/RenyEnnos/openbanca/issues/65).

| Situação | Documento obrigatório |
|---|---|
| Qualquer revisão ou avaliação de código | `docs/ai-review-protocol.md` |
| Criar, editar, priorizar ou fechar issue | `docs/issue-labeling-policy.md` e `.github/labels.yml` |
| Aplicar ou remover o label `jules` | `docs/jules-dispatch-protocol.md` |
| Preparar tamanho/contrato de tarefa para Jules | `docs/jules-task-sizing.md` |
| Validar OpenCode no ambiente do Jules | `docs/jules-opencode-environment.md` |
| Contribuir com PR humana | `CONTRIBUTING.md` e `.github/PULL_REQUEST_TEMPLATE.md` |
| Descobrir scripts e pipeline de CI | `package.json` e `.github/workflows/ci.yml` |

O código, os testes e o estado real do HEAD prevalecem sobre planos, descrições de PR, comentários, memória do agente ou documentação desatualizada.

## Ordem de autoridade

Ao executar uma tarefa, use esta ordem:

1. regras de segurança e governança do repositório (`AGENTS.md` e protocolos);
2. contrato explícito da issue ou da PR (escopo, arquivos permitidos, critérios);
3. este fluxo operacional;
4. documentação geral e sugestões do agente.

Uma instrução específica pode limitar o escopo, mas **não autoriza**:

- ignorar segurança;
- inventar evidência, resultados, citações, referências, conteúdo acadêmico ou compatibilidade;
- alterar prioridade, labels ou governança sem evidência e comentário;
- trabalhar sobre a base, branch ou PR erradas;
- misturar alterações locais de terceiros com o escopo da tarefa.

## Preflight obrigatório

Antes de editar qualquer arquivo, atualize o estado remoto e registre a realidade local.

Os comandos abaixo são o padrão para Linux e macOS com shell Bash/Zsh. Em ambientes sem Bash, adapte a sintaxe sem alterar o significado das checagens. Não presuma comportamento de Windows.

**Não** coloque `set -euo pipefail` (nem equivalente) no início de blocos de preflight para sessão interativa de agente. Em sessão interativa, essa opção pode encerrar o shell inteiro se um comando falhar (por exemplo, `git merge-base` sem histórico comum). Use-a apenas em scripts versionados que sejam deliberadamente fail-fast, não como procedimento padrão do agente no terminal.

### Resolver a base autorizada (`BASE_REF`)

Antes de qualquer `git rev-parse` ou `git merge-base` contra a base:

1. leia o contrato da tarefa ou os metadados da PR (`base` / `baseRefName`);
2. atribua `BASE_REF` à **ref remota exata** autorizada;
3. o padrão do repositório é `origin/master`, mas **não presuma** `master` quando a base autorizada for outra (por exemplo, PR empilhada).

A atribuição precisa ser um comando real na sessão. Um comentário sozinho **não** define a variável.

### Preflight geral

```bash
git fetch origin --prune

# Resolva a base antes de usá-la. Exemplos:
#   BASE_REF=origin/master
#   BASE_REF=origin/<branch-base-autorizada>
BASE_REF=origin/master

git status --short --branch
git branch --show-current
git rev-parse HEAD
git rev-parse "$BASE_REF"
git merge-base HEAD "$BASE_REF"
node --version
bun --version
```

Substitua o valor de `BASE_REF` quando o contrato/metadata da PR autorizar base diferente de `master`.

### Preflight com branch ou PR existente

Se a tarefa nomear uma branch ou PR existente, faça checkout dessa branch **antes** de editar e confirme que o trabalho pertence a ela:

```bash
git fetch origin --prune
git checkout <branch-da-tarefa>
git pull --ff-only

# Resolva BASE_REF dos metadados/contrato da PR antes deste bloco.
# Exemplos: origin/master  |  origin/<branch-base-autorizada>
BASE_REF=origin/master

git branch --show-current
git rev-parse HEAD
git rev-parse "$BASE_REF"
git merge-base HEAD "$BASE_REF"
git status --short
```

Registre no relatório:

- branch atual;
- SHA inicial;
- base autorizada (`BASE_REF`) e seu SHA;
- merge-base com a base autorizada;
- versões de Node e Bun, quando relevantes;
- alterações locais preexistentes;
- número da PR de destino, quando o trabalho for de PR existente.

Confirme que:

- a branch atual é a autorizada pela tarefa;
- o trabalho não deveria estar em outra PR ou branch;
- `BASE_REF` corresponde à base do contrato/metadata (não a um padrão inventado);
- o merge-base com a base autorizada é coerente com o contrato da PR;
- não há mudanças locais não relacionadas misturadas ao estágio.

### Preservar trabalho alheio

Se houver mudanças locais não relacionadas:

- **não** as apague;
- **não** use restore destrutivo, `git reset --hard` ou `git clean -fd` como atalho;
- **não** as inclua no commit;
- preserve o trabalho existente e altere somente os arquivos autorizados.

### Segredos e dados sensíveis

Não execute `env`, `printenv` ou comandos equivalentes que possam despejar credenciais no terminal ou em logs.

Nunca imprima, versione, faça commit ou cole em issue/PR/relatório:

- tokens, chaves de API, senhas ou cookies;
- conteúdo de `.env` ou variáveis secretas;
- caminhos privados desnecessários;
- manuscritos reais ou dados pessoais;
- saídas que contenham credenciais.

Se um comando puder vazar segredo, redija a saída ou não o execute.

### Dependências

Se a tarefa exigir dependências instaladas:

```bash
bun install --frozen-lockfile
```

Não altere `bun.lock` apenas para contornar um ambiente inconsistente. Não atualize dependências fora do escopo da tarefa.

## Confirmar a tarefa real

Antes da implementação:

1. leia a issue, comentários, labels e dependências, quando existirem;
2. leia a PR relacionada, incluindo descrição, review threads e checks;
3. confirme se o trabalho pertence a uma **PR existente** ou a uma **nova** entrega;
4. confirme que não existe outra PR ou branch ativa para o mesmo escopo;
5. confira se a tarefa está desbloqueada (`agent:ready` e ausência de bloqueios aplicáveis);
6. identifique arquivos permitidos, testes e critérios de aceite;
7. compare as evidências da issue/PR com o HEAD real.

Não implemente tracking issue, issue-mãe ou plano amplo como se fosse tarefa-folha.

Não trate como verdade, por si só:

- descrição de PR;
- plano ou resumo do agente;
- comentário dizendo que algo foi corrigido;
- arquivo presente em disco sem descoberta pelo sistema real;
- mock como prova de integração;
- build como prova funcional;
- catálogo de modelos como prova de autenticação ou inferência;
- teste executado em SHA antigo.

## Estratégia de branch e PR

### Trabalho novo (sem PR existente)

Por padrão:

1. parta de `origin/master` atualizada;
2. crie **uma** branch dedicada, por exemplo `agent/<issue>-<descricao-curta>`;
3. produza **no máximo uma** PR por tarefa;
4. a PR deve apontar para `master`, salvo autorização humana explícita com base diferente;
5. abra a PR como draft, salvo instrução explícita em contrário.

### Trabalho em PR existente

Quando a tarefa nomear uma PR existente (número, branch head e base):

1. faça checkout da **branch head da PR**, não crie outra branch;
2. confirme base, head e merge-base com o remoto;
3. faça commits e push **somente** nessa branch;
4. **não** abra outra PR;
5. **não** altere a base da PR sem autorização humana explícita;
6. **não** faça squash, rebase interativo, merge de `master` na branch ou force push sem autorização humana explícita e necessidade objetiva.

### Proibições de publicação

- não faça push direto em `master`;
- não faça force push (`git push --force`, `--force-with-lease` inclusive) sem autorização humana explícita;
- não execute `git reset --hard`, `git clean -fd`, restore destrutivo ou rebase forçado como procedimento normal;
- não crie issue, branch ou PR duplicada para o mesmo escopo;
- não marque a PR como pronta nem faça merge por conta própria quando a tarefa exigir auditoria humana.

### Antes do commit (diff local ainda não commitado)

Use `git --no-pager` em toda inspeção de diff para o comando não abrir paginador interativo (`less` etc.) e travar a sessão do agente.

```bash
git status --short --branch
git --no-pager diff --check
git --no-pager diff --stat
git --no-pager diff
```

Revise **todo** o diff local. Não use `git add -A` quando existirem mudanças fora do escopo. Adicione apenas os arquivos da tarefa:

```bash
git add <arquivo1> <arquivo2> ...
```

Confirme com `git status --short` e, se útil, `git --no-pager diff --cached` que o stage contém somente o permitido.

### Validação final do diff da PR (contra a base)

Revisar apenas alterações locais ainda não commitadas **não basta**. Antes de declarar a entrega pronta, revise o **diff completo da PR** no HEAD final contra a base autorizada:

```bash
# Resolva BASE_REF pelo contrato/metadata da PR.
# Padrão do repositório: origin/master
# Se a PR tiver base explicitamente autorizada diferente, use essa base exata.
BASE_REF=origin/master

git fetch origin --prune
git --no-pager diff --check "$BASE_REF"...HEAD
git --no-pager diff --stat "$BASE_REF"...HEAD
git --no-pager diff "$BASE_REF"...HEAD
git --no-pager diff --name-only "$BASE_REF"...HEAD
```

Confirme que:

- somente os arquivos autorizados aparecem no range `"$BASE_REF"...HEAD`;
- não há whitespace error reportado por `diff --check`;
- o conteúdo do range da PR é o que será avaliado no merge, não só o working tree local.

Se o trabalho ainda tiver mudanças não commitadas, revise-as com a seção anterior **e** o range da PR após o commit no HEAD final.

## Escopo e arquivos permitidos

- Altere somente o que o contrato da issue/PR autoriza.
- Não “aproveite” a tarefa para refatorar, reformatar ou renomear arquivos não relacionados.
- Não altere workflows, dependências, labels, issues, templates ou governança sem autorização explícita do escopo.
- Se a correção exigir arquivos fora do permitido, pare e registre bloqueio em vez de expandir o escopo silenciosamente.

## Método de implementação

Use o menor diff que resolva a causa central.

1. reproduza ou demonstre o comportamento atual no HEAD real;
2. identifique a causa no código, sem assumir que a hipótese da issue está correta;
3. leia testes e contratos existentes antes de criar novas abstrações;
4. adicione ou ajuste teste de regressão ligado ao defeito, quando o escopo for código;
5. implemente a correção no componente compartilhado apropriado;
6. execute testes focados durante o desenvolvimento;
7. execute a validação aplicável no HEAD final;
8. revise o diff completo antes de publicar.

Não:

- reformate arquivos não relacionados;
- renomeie APIs públicas sem necessidade;
- altere prioridade, labels ou governança como efeito colateral;
- introduza dependência nova sem justificar necessidade e impacto;
- amplie o escopo para corrigir problemas independentes;
- deixe TODO, placeholder, aprovação hardcoded ou classificação incondicional para simular conclusão;
- invente fatos acadêmicos, resultados, referências, citações ou compatibilidade.

Quando encontrar outro problema, registre-o separadamente em vez de misturá-lo na mesma PR, salvo quando for inseparável da mesma causa.

## Invariantes de arquitetura

Estas regras valem sempre que o escopo tocar o subsistema correspondente. Não as contorne com atalho local.

### Lógica compartilhada

Regras centrais devem ficar em `src/lib`. Não duplique parsing, segurança de paths, scoring, carregamento de manuscrito ou políticas de cobertura dentro de várias tools.

Antes de criar uma função nova, procure implementação equivalente e avalie reutilização ou refatoração controlada.

### Manuscrito canônico

Qualquer trabalho de ingestão ou análise deve caminhar para uma única representação canônica do manuscrito.

Nunca apresente uma auditoria como completa quando ela:

- lê somente o preâmbulo ou `main.tex` sem os includes;
- ignora `\input` ou `\include` aninhados;
- concatena arquivos por ordem alfabética sem relação documental;
- depende de pasta hardcoded;
- ignora `manuscript.chapters`;
- trunca conteúdo silenciosamente;
- perde proveniência por arquivo e linha;
- converte erro de ingestão em ausência de conteúdo.

A implementação deve proteger contra ciclos, path traversal e arquivos ausentes, mantendo diagnósticos estruturados. Preserve a ordem documental real (`main.tex`, `\input`, `\include`), não uma ordem inventada.

### Scoring

Deve existir uma única implementação de scoring usada por auditoria, status, loop, correção e integradores.

Escala, pesos, target, tetos, arredondamento, fórmula e versão da rubrica devem ser explícitos. Não introduza:

- aprovação hardcoded;
- fórmulas divergentes entre tools;
- nota impossível de atingir;
- score calculado sobre representações diferentes do manuscrito;
- nota conclusiva quando a cobertura estiver bloqueada.

### Correção e restore

Correções devem ser auditáveis e preservar fatos acadêmicos.

- crie ou vincule snapshot antes de alterações quando o fluxo exigir;
- respeite paths permitidos, protegidos e imutáveis;
- valide o path real antes de escrever, copiar ou remover;
- produza diff verificável;
- não invente fatos, resultados, referências ou citações;
- não registre `rollback` sem restaurar realmente os arquivos;
- não execute restore ou migração destrutiva sem política explícita.

### Detecção de IA e plágio

- detecção de IA é **heurística**, não prova forense nem veredito absoluto;
- plágio e similaridade são **entradas ou sinais**, não veredito final de má-fé;
- não apresente score heurístico como certeza jurídica, acadêmica ou moral;
- preserve proveniência e limites do método no relatório.

### Assets e fallbacks

Assets instalados e fallbacks embarcados devem permanecer equivalentes ou ser gerados por fonte única.

Presença no repositório, cópia em disco ou instalação local **não prova** que o OpenCode descobriu ou carregou o asset.

### Processos externos

Ao executar subprocessos em código ou automações:

- use executável conhecido ou allowlist;
- passe argumentos como lista separada, não como string interpolada de shell;
- use `shell: false` (ou equivalente) em APIs de processo;
- defina timeout;
- limite stdout e stderr;
- garanta encerramento em sucesso, erro e timeout;
- não inclua segredos em argumentos, logs ou relatórios;
- registre falhas de forma sanitizada.

Falha de provedor não prova inexistência de uma referência ou recurso.

## Segurança de paths

Todo path derivado de usuário, estado, manuscrito ou ferramenta externa deve ser validado contra o root autorizado.

Considere:

- paths absolutos POSIX;
- drives e paths UNC do Windows;
- `.` e `..`;
- separadores mistos;
- symlinks;
- caracteres NUL ou de controle;
- normalização e comparação com separador de diretório.

Confinamento lexical e confinamento após `realpath` são garantias diferentes. Quando houver leitura ou escrita real, confirme que o destino efetivo permanece no root permitido.

Nunca exponha paths privados desnecessários em logs, issues ou PRs.

## Níveis de evidência

Diferencie sempre o tipo de prova. Não promova um nível inferior a um superior.

| Nível | O que comprova | O que **não** comprova |
|---|---|---|
| Inspeção estática | Leitura de código, diff, config ou docs | Comportamento em execução |
| Typecheck/build | Compilação ou tipos no HEAD | Comportamento funcional correto |
| Teste unitário | Comportamento isolado sob controle do teste | Integração real com host/serviço |
| Teste com mock | Contrato simulado | Sistema externo real |
| Integração local determinística | Parser, scripts ou binário sem modelo | Autenticação, inferência ou E2E completo |
| Execução real com OpenCode | Descoberta/carregamento pelo host real | Qualidade da resposta de um LLM |
| Execução real com modelo | Comportamento dependente de LLM no ambiente | Generalização para todos os modelos/ambientes |

Regras:

- build aprovado ≠ prova funcional;
- mock ≠ integração;
- catálogo de modelos ≠ autenticação ou inferência;
- arquivo em disco ≠ descoberta pelo OpenCode;
- “testes passaram” sem listar comandos e códigos de saída **não** é evidência;
- evidência de SHA antigo **não** vale para o HEAD final.

## Testes e validação

### Como descobrir o que executar

Não invente a suíte. Descubra os scripts reais em:

1. `package.json` → campo `scripts`;
2. `.github/workflows/ci.yml` → passos do pipeline;
3. `scripts/` → validadores e utilitários versionados;
4. o contrato da issue/PR → testes adicionais ou E2E pedidos.

Execute primeiro o teste **focado** da mudança (arquivo de teste ou script ligado ao defeito). No HEAD final, alinhe-se ao que o CI executa, salvo restrição documentada do ambiente.

### Baseline atual do repositório

O pipeline de CI atual executa, em essência:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run build
bun test
bash scripts/validate.sh
bash scripts/check-secrets.sh --ci
```

Confirme em `.github/workflows/ci.yml` e `package.json` se a suíte mudou. Scripts adicionais (por exemplo `bun run validate:skills`, `bun run validate:agents`, `bun run e2e:opencode`) só são obrigatórios quando o escopo ou a issue os exigir.

Registre o código de saída de cada comando. Não resuma vários comandos como aprovados sem informar o que foi executado.

Se um comando falhar:

1. preserve a saída relevante (sanitizada);
2. identifique se a falha veio da mudança, do HEAD de base ou do ambiente;
3. corrija falhas determinísticas **dentro do escopo**;
4. execute novamente no SHA final;
5. não esconda teste reprovado.

Declare honestamente os testes **não executados** e o motivo (fora do escopo, ambiente ausente, sem credencial, não aplicável a mudança documental, etc.).

## E2E e sistemas reais

Quando a tarefa envolver OpenCode, MCP, LaTeX, Python, GitHub Actions ou outro sistema externo, determine se o critério exige execução real.

Registre:

- branch e SHA;
- versões das ferramentas;
- binário efetivamente usado;
- comandos sanitizados;
- códigos de saída;
- stdout e stderr relevantes;
- resultado por fase;
- limitações.

Classifique cada fase como:

- `PASS`: comportamento exigido foi executado e comprovado;
- `FAIL`: comportamento foi executado e não atendeu ao critério;
- `BLOCKED`: a etapa não pôde ser executada por condição objetiva do ambiente.

Use `CLI_ONLY` quando somente parser, descoberta ou comando sem modelo tiver sido exercitado. Não trate listagem de modelos como prova de autenticação ou inferência.

Se o ambiente bloquear uma etapa externa, implemente e teste tudo que for determinístico. Não produza commit vazio ou apenas declaratório. Para OpenCode no Jules, siga `docs/jules-opencode-environment.md`.

## Issues, labels e GitHub

Antes de criar, editar, priorizar ou fechar uma issue, leia `docs/issue-labeling-policy.md` e `.github/labels.yml`. Não invente labels.

Resumo operacional (detalhes e critérios estão na política):

- todo issue aberto: exatamente um tipo, exatamente uma prioridade, uma ou duas áreas;
- labels operacionais somente com critérios atendidos;
- não altere prioridade sem comentário com evidência e impacto residual;
- não aplique `agent:ready` com decisão pendente;
- não use `agent:blocked` sem condição de desbloqueio;
- não remova `needs:e2e` sem evidência real;
- o label `jules` é gatilho de execução com protocolo próprio — não é fila genérica de agente de terminal.

Não feche uma issue só porque existe PR ou commit. Confirme critérios, testes, CI e E2E aplicáveis no HEAD correspondente.

Não crie issue duplicada para o mesmo defeito já coberto por issue ou PR aberta.

## Commit e PR

O commit deve descrever apenas o escopo implementado. Não use mensagem que feche tracking issue ou issue parcialmente resolvida.

A descrição da PR deve informar:

- o que mudou;
- por que mudou;
- arquivos e contratos afetados;
- como foi testado;
- comandos e resultados (ou não-execuções honestas);
- limitações e itens não executados;
- issue relacionada;
- riscos ou acompanhamentos.

Use o template em `.github/PULL_REQUEST_TEMPLATE.md` quando criar PR nova. Em PR existente, atualize a descrição **ou** publique comentário de evidência com o **HEAD final**, merge-base, arquivos do range `"$BASE_REF"...HEAD`, comandos/códigos de saída e CI do SHA atual. Não deixe a descrição apontando para SHA ou run de CI de um HEAD anterior como se fossem a evidência final.

Não faça merge da PR por conta própria neste fluxo, salvo autorização humana explícita.

## Condições para parar e registrar bloqueio

Pare antes de implementar ou publicar quando:

- a branch-base ou a PR de destino estiver errada;
- houver PR ou tarefa concorrente para o mesmo escopo;
- faltar decisão humana de produto, arquitetura, política ou risco;
- os arquivos necessários estiverem fora do escopo autorizado;
- a correção exigir operação destrutiva não autorizada;
- houver risco de expor credenciais ou manuscrito real;
- a tarefa combinar objetivos independentes demais;
- a dependência obrigatória ainda não estiver integrada.

Um bloqueio deve informar:

- condição objetiva;
- evidência;
- trabalho determinístico já concluído;
- condição de desbloqueio;
- arquivos não alterados por segurança.

## Relatório final obrigatório

Ao terminar, entregue um relatório com:

1. branch efetivamente usada;
2. SHA inicial;
3. base autorizada (`BASE_REF`) e seu SHA;
4. merge-base com a base autorizada;
5. SHA final;
6. arquivos do range `"$BASE_REF"...HEAD` (não só o working tree);
7. resumo técnico da implementação;
8. comandos executados e códigos de saída;
9. testes aprovados, reprovados, bloqueados e **não executados** (com motivo);
10. CI observado no HEAD final, se aplicável (não reutilize run de SHA antigo);
11. E2E executado ou não executado;
12. limitações e riscos restantes;
13. divergências entre o pedido, o plano e a implementação real;
14. URL ou número da PR, quando houver;
15. confirmação de que não criou branch/PR indevida e não alterou arquivos fora do escopo.

Nunca declare que algo está aprovado, seguro, integrado ou validado sem evidência correspondente no SHA informado.
