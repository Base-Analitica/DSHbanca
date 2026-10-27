# Governança de agentes para o DSHbanca

Estas regras orientam revisão de código, implementação, testes, documentação e manutenção de issues do repositório Base-Analitica/DSHbanca. O escopo de produto é exclusivamente acadêmico e integrado ao DeepSeek Harness (DSH).

## Antes de agir

1. Leia esta governança e `docs/terminal-agent-workflow.md` antes de editar.
2. Leia `docs/ai-review-protocol.md` para o processo geral de revisão. Se ele divergir desta arquitetura quanto ao harness, compatibilidade ou validação, trate a afirmação divergente como dívida documental, não como autorização técnica.
3. Leia `docs/issue-labeling-policy.md` e consulte `.github/labels.yml` antes de criar, editar, priorizar ou fechar issues. Esses arquivos continuam sendo a fonte atual dos nomes de labels, apesar de conterem nomenclatura legada que precisa de tratamento em trabalho documental separado. Não invente nem renomeie labels nesta tarefa.
4. Leia a issue completa, os comentários relevantes, a PR de destino e seus checks. Confirme o escopo e o estado real do código no SHA em que trabalhará.
5. Antes de tocar uma integração DSH, verifique a versão efetivamente instalada do DSH, Cordis e pacotes relacionados, além das assinaturas públicas que o código usará. Não deduza APIs a partir de exemplos de outra versão.
6. Registre branch, SHA inicial, base autorizada, merge-base, runtime e alterações locais preexistentes. Preserve todo trabalho alheio.
7. Antes de executar testes, inspecione os scripts em `package.json`, os workflows de CI e o próprio caminho de execução para identificar subprocessos, rede, credenciais e inferência.

## Invariante arquitetural: DSH é o único harness

O DSH é o único harness deste repositório. Cordis é a integração nativa do plugin com o host. O DSH é proprietário das capacidades gerais do harness, incluindo runtime, modelos e autenticação de provedores, sessões, identidade e lifecycle de agentes, tool dispatch, permissões, skills, plugins e configuração do ambiente.

O DSHbanca é responsável pela camada acadêmica específica do projeto, incluindo:

- representação e ingestão do manuscrito acadêmico;
- cobertura, segmentação e proveniência por lote;
- checkpoints e estado acadêmico do projeto;
- rubricas, findings estruturados e fingerprints;
- validações acadêmicas determinísticas e guardrails de correção;
- snapshots, changesets e contratos acadêmicos;
- ferramentas acadêmicas consumidas pelo DSH.

Essa separação é normativa, mas não prova que todos os fluxos estejam integrados ou executáveis. A documentação deve distinguir código presente, comportamento unitário, integração observada no DSH real e comportamento dependente de modelo.

### Preflight obrigatório host-first

Antes de criar cliente, adapter, runtime, servidor, subprocesso persistente, controlador de sessão, executor de agentes, permission engine ou integração, responda no relatório:

1. Qual versão instalada do DSH/Cordis foi inspecionada?
2. Qual API, SDK, serviço, plugin, configuração ou lifecycle nativo foi verificado, com pacote e assinatura?
3. Qual lacuna concreta permanece no host, reproduzida no ambiente real?
4. Por que a solução pertence ao domínio acadêmico do DSHbanca?
5. Como o escopo impede que o componente vire infraestrutura geral ou um segundo harness?
6. Qual evidência real do DSH, em SHA identificado, comprova a necessidade e o resultado?
7. Quem possui lifecycle, ambiente, credenciais e fallback? Qual plano de remoção existe se o host cobrir a lacuna?

Sem lacuna concreta, use a API nativa do DSH. Se o contrato não estiver disponível ou não puder ser verificado, registre `BLOCKED`. Não invente APIs nem substitua uma funcionalidade do host por mocks apresentados como integração.

### Plugins, tools, skills e agentes

- Use Cordis e as APIs públicas do DSH para declarar, compor e registrar funcionalidades acadêmicas.
- Não implemente loop de agente, seleção ou roteamento geral de modelos, autenticação direta em provedores, gerenciamento de sessões paralelo, permission engine, catálogo de agentes ou lifecycle de plugins próprio.
- Um arquivo em `assets/`, uma cópia instalada, uma declaração com nome conhecido ou um teste de registro não prova descoberta, associação ao agente nem uso pelo host. Valide cada etapa no DSH real quando a alegação depender dela.
- O ciclo de vida de ferramentas, agentes, sessões e plugins pertence ao DSH/Cordis. O plugin não deve reter processos ou recursos fora do contrato nativo.
- MCPs e integrações gerais com provedores são geridos pelo host. Não crie nem amplie cliente MCP genérico no DSHbanca. Lógica acadêmica sobre resultados, como normalização, matching, classificação ou proveniência, pode permanecer no domínio do plugin quando houver justificativa específica.

### Identidade e segurança acadêmica

- O perfil `banca-auditor` é read-only. O perfil `banca-corretor` é o caminho acadêmico destinado a alterações autorizadas. A identidade precisa vir do DSH e ser validada no dispatch, não de texto livre ou campo artificial do teste.
- A ausência de identidade confiável, preset não verificado ou delegação sem papel corretor não concede autorização para alterar o manuscrito.
- Negativas de segurança precisam ocorrer antes do corpo da ferramenta. Teste com argumentos válidos e registre a classificação da negação, hashes dos arquivos protegidos, estado persistente e teardown.
- Instruções Markdown orientam um agente, mas não substituem enforcement técnico. Só declare conteúdo como carregado quando a associação e projeção forem observadas no host real. Não eleve silenciosamente texto a papel de sistema ou autoridade superior.
- Mudanças no trust model, nas permissões, na identidade, nas atribuições de agentes ou nas proteções read-only exigem decisão humana registrada antes da implementação.
- Correções acadêmicas, alterações de rubricas, scoring, nota, aprovação, reprovação ou interpretação institucional exigem autorização humana explícita e escopo definido. Não use manuscritos reais para testes sem autorização.

## Evidência e validação

Classifique cada resultado sem promover evidência inferior:

| Nível | Comprova | Não comprova |
|---|---|---|
| Inspeção de código/configuração | APIs declaradas, configuração e fluxo pretendido | Execução ou descoberta pelo DSH |
| Typecheck e build | Tipos e compilação naquele SHA | Correção funcional ou integração |
| Unitário | Comportamento isolado coberto pelo teste | Host real |
| Mock ou fixture | Contrato simulado e casos controlados | DSH/Cordis real |
| DSH real sem modelo | Descoberta, lifecycle, dispatch, permissões e ferramentas exercitadas no host, se observados | Inferência, qualidade de resposta ou juízo acadêmico do modelo |
| Modelo real | Apenas o comportamento dependente do modelo no ambiente e configuração registrados | Generalização para outros modelos ou projetos |

- Use `PASS`, `FAIL` ou `BLOCKED` por gate. `BLOCKED` significa que o caminho exigido não foi executado, não que passou.
- Antes de usar um modelo, enviar prompt, autenticar provedor ou incorrer em custo, obtenha autorização humana específica para esse teste. O comportamento padrão é não usar credenciais nem fazer inferência.
- Verifique `package.json`, CI e testes antes de `bun test`. Não execute testes de integração capazes de iniciar harnesses, rede ou modelos sem demonstrar isolamento e autorização.
- Registre SHA, comando, exit code, evidência observada, versão do DSH/Cordis quando aplicável, limitações e teardown.
- Um E2E DSH real é obrigatório para alegações de integração ou enforcement pelo host. CI convencional, build, fixture e histórico de outro SHA não o substituem.

## Issues, labels e autonomia

Todo issue aberto deve manter, segundo a política e a fonte de labels vigentes:

- exatamente um tipo entre `bug`, `enhancement` e `documentation`;
- exatamente uma prioridade entre `priority:p0` e `priority:p3`;
- uma ou duas áreas existentes;
- labels operacionais apenas quando os critérios estiverem comprovados.

Não invente labels. Não altere prioridade sem comentário com evidência e impacto residual.

- `agent:ready` significa que a tarefa pode ser executada sem decisão adicional.
- `agent:blocked` exige bloqueio concreto e condição de desbloqueio documentados.
- `needs:human-decision` impede escolher silenciosamente entre opções de produto, arquitetura, política ou risco.
- `needs:e2e` impede fechar o issue sem a evidência real solicitada.

A taxonomia de labels ainda contém nomes históricos de outro harness. Ela não altera o invariante DSH-only e deve ser atualizada em trabalho separado, sem criar labels nesta tarefa.

## Branches, revisão e segurança

- Trabalhe na branch e PR autorizadas. Para trabalho novo, parta de `origin/master` atualizada e crie uma única branch dedicada e, quando solicitado, uma PR draft.
- Não crie PR duplicada para correção que pertence a uma PR existente. Não faça push direto em `master`, force-push, merge, release ou publicação sem autorização explícita.
- Use worktree separado quando mudanças locais preexistentes puderem ser afetadas. Não execute `git reset --hard`, `git clean -fd` nem restore destrutivo como atalho.
- Modifique apenas arquivos do escopo. Faça stage explícito dos arquivos autorizados e revise o diff local e o range completo `BASE_REF...HEAD` antes de publicar.
- Não exponha tokens, chaves, credenciais, conteúdo de `.env`, caminhos privados, dados pessoais ou manuscritos reais em terminal, logs, issues, commits ou PRs.
- Não altere workflow, proteção de GitHub, dependências, licença, rubrica ou política de acesso fora do escopo autorizado.

## Fechamento de issues

Antes de fechar um issue, registre o que mudou, commit/PR, testes e códigos de saída, limites não validados e acompanhamento necessário. Se parte do problema continuar aberta ou bloqueada, mantenha o issue aberto para revisão humana.
