# Contribuindo para o DSHbanca

O DSHbanca é um plugin acadêmico exclusivamente para **DSH (DeepSeek Harness)**, composto nativamente via **Cordis**. OpenBanca é um projeto separado para OpenCode; referências a esse harness neste repositório são legado histórico, não alternativa de execução nem fallback.

O DSH fornece runtime, agentes, sessões, modelos, permissões, skills, tools e lifecycle. O DSHbanca cuida de manuscritos, cobertura, checkpoints, findings, rubricas, proveniência, correções autorizadas e guardrails acadêmicos. Essa divisão é normativa, não prova de integração concluída.

Antes de contribuir, leia [AGENTS.md](AGENTS.md), a [arquitetura](docs/architecture.md), o [fluxo de terminal](docs/terminal-agent-workflow.md) e o [protocolo de revisão](docs/ai-review-protocol.md). Confira o estado real da base em [README.md](README.md) e [ROADMAP.md](ROADMAP.md); funcionalidades propostas na PR #1 draft não estão disponíveis na `master`.

## Como Abrir uma Issue

1. Verifique se a issue já existe
2. Use o template apropriado (bug report, improvement, ai review)
3. Forneça informações claras e específicas
4. Inclua passos para reproduzir (se aplicável), SHA, evidências, impacto, escopo e critérios de aceite.
5. Siga a [política de issues e labels](docs/issue-labeling-policy.md) e a [fonte de labels](.github/labels.yml): exatamente um tipo (`bug`, `enhancement` ou `documentation`), uma prioridade (`priority:p0` a `priority:p3`) e uma ou duas áreas existentes. Para integração DSH/Cordis, use `area:dsh`.
6. Respeite os critérios operacionais: `agent:ready` permite execução; `agent:blocked` e `needs:human-decision` impedem implementar a parte bloqueada ou ambígua; `needs:e2e` exige a prova real solicitada antes do fechamento. Não invente labels nem altere prioridade silenciosamente.

### Tipos de Issue

- **Bug Report**: Reporte um problema encontrado
- **Improvement**: Sugira uma melhoria
- **AI Review**: Compartilhe resultados de revisão por IA

## Como Propor uma Melhoria

1. Abra uma issue descrevendo a melhoria
2. Explique o problema que ela resolve
3. Aguarde discussão antes de implementar
4. Após aprovação, crie um branch e PR

## Como Revisar uma Skill

1. Leia o `SKILL.md` da skill
2. Verifique se a documentação está completa
3. Inspecione o caminho de execução antes de testar; valide no DSH real apenas quando seguro, autorizado e exigido pelo escopo. Validação de frontmatter não prova discovery nem uso da skill.
4. Verifique se há guardrails adequados
5. Abra uma issue ou PR com suas observações

## Como Enviar um PR

1. Confira a issue completa e possíveis duplicatas de branch/PR. Faça `git fetch origin --prune`; registre branch, HEAD, base autorizada (normalmente `origin/master`), merge-base, versões Node/Bun e estado local.
2. Preserve alterações preexistentes; use worktree isolado quando houver trabalho não relacionado. Crie uma branch dedicada da base remota atualizada, ou continue na branch/PR indicada pelo contrato, sem duplicá-la.
3. Altere somente o escopo autorizado e cumpra o preflight de segurança e a validação abaixo.
4. Revise o diff local e o range completo `origin/master...HEAD` (ou a base autorizada), faça stage explícito e use commit descritivo. Não faça push direto na base nem force-push.
5. Abra uma única PR **draft** contra `master`, salvo base diferente autorizada, vinculando a issue com `Closes #N` (número real). Siga o [template de PR](.github/PULL_REQUEST_TEMPLATE.md) e registre evidências, limitações e checks no HEAD publicado. Deixe a revisão independente e a decisão de merge para o mantenedor.

### Padrão de Commits

Use commits descritivos em português:

```
feat: adicionar nova tool de validação
fix: corrigir cálculo de nota integrada
docs: atualizar guia de instalação
test: adicionar testes para banca_refs
chore: atualizar dependências
```

### Evidências na PR

Use o template vigente, sem duplicá-lo neste guia. Informe SHA inicial/final, base e merge-base, comandos exatos e exit codes, comparação RED → GREEN (documental quando aplicável), gates `PASS`/`FAIL`/`BLOCKED`, evidências e limitações. Consulte e vincule os checks da CI no HEAD publicado; não apresente resultado de outro SHA como prova atual.

## Regras Importantes

### Não Invente Compatibilidade

Se você adicionar uma funcionalidade, documente:
- Requisitos
- Limitações
- Casos de uso

Não afirme compatibilidade que não foi testada. Inspeção, review, typecheck/build, unitários, mocks e CI convencional não substituem E2E no DSH real no SHA final para alegações de integração, discovery, associação, dispatch ou enforcement. Uma correção documental não comprova esses gates.

### Documente Toda Mudança

Documente requisitos, evidências e limitações no escopo autorizado. Atualize comentários, changelog ou README quando pertinentes ao contrato e ao impacto em API, uso ou runtime; uma correção puramente documental não exige alterar esses arquivos indiscriminadamente.

### Não Exponha Segredos

Nunca commit:
- Tokens
- Chaves de API
- Senhas
- Caminhos locais sensíveis
- Dados pessoais
- Manuscritos reais ou conteúdo acadêmico sensível

Use fixtures sintéticas e preserve proveniência, cobertura e guardrails. O `banca-auditor` deve ser read-only; instruções Markdown não substituem enforcement técnico. Correções acadêmicas e alterações de rubricas, scoring ou critérios institucionais exigem autorização humana explícita e escopo definido. Não conceda permissões para facilitar testes.

### Teste Antes de Enviar

Antes de qualquer suíte ou script, leia [package.json](package.json), a [CI](.github/workflows/ci.yml) e os testes/runners envolvidos. Trace subprocessos, resolução de executáveis, rede, configurações pessoais, variáveis herdadas, credenciais e modelos. Só execute caminhos externos com segurança e autorização demonstradas.

Na base, [tests/e2e-opencode.test.ts](tests/e2e-opencode.test.ts) pode descobrir um binário externo e invocar o [runner legado](scripts/e2e-opencode.ts), com cópia de autenticação (`seedAuth: true`) e modelo. Não inicie esse runner para validar documentação, não ative OpenCode e não forneça credenciais ou modelo. A correção proposta na PR #1 não deve ser presumida na `master`.

A suíte integral (`bun test`) só pode ser executada após comprovar segurança e isolamento, inclusive HOME/PATH temporários, ausência de credenciais e inacessibilidade de configuração pessoal e executável externo, com autorização aplicável. Se não for possível, registre **`BLOCKED`**, causa objetiva, impacto residual e apenas testes locais explicitamente inspecionados como seguros, com comandos e exit codes. Não simule `PASS`.

Após esse preflight, execute os gates compatíveis e seguros, definidos no projeto:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run build
bun run validate:skills
bun run validate:agents
bash scripts/validate.sh
bash scripts/check-secrets.sh --ci
git diff --check
```

Registre o que efetivamente executou, versões e limitações; classifique gates não executados como `BLOCKED`. Não use modelo, credenciais, manuscritos reais ou lifecycle DSH ativo para cumprir uma tarefa documental.

## Perguntas?

Consulte as issues existentes; se necessário, use o template apropriado e a política de triagem acima, sem inventar labels.
