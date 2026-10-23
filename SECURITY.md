# Política de Segurança

## Escopo e Estado das Proteções

O **DSH é o único harness** do DSHbanca; Cordis é a integração nativa com o host. OpenBanca é outro projeto, destinado ao OpenCode: referências a esse harness neste repositório são **legado não suportado**, não alternativa de execução ou fallback.

- **DSH**: responsabilidade por runtime, autenticação, sessões e identidade/lifecycle de agentes, dispatch de ferramentas, permissões e integração nativa com serviços externos.
- **DSHbanca**: responsabilidade por dados acadêmicos, confinamento de arquivos ao projeto, guardrails, evidências/proveniência, snapshots e correções autorizadas. Não implementa um segundo runtime nem um permission engine paralelo.

Diferencie os níveis de proteção:

- **Pretendida (política)**: as diretrizes abaixo são requisitos de segurança, não garantias de enforcement.
- **Implementada no código**: há validações locais de caminhos, armazenamento e execução externa, com limites descritos abaixo; presença de código não prova uso pelo host.
- **Comprovada no DSH real**: exige evidência no SHA e ambiente efetivamente testados. A integração nativa e o guard read-only ainda pertencem à [PR #1 (draft)](https://github.com/Base-Analitica/DSHbanca/pull/1); a associação/projeção do Markdown do auditor segue bloqueada na [issue #3](https://github.com/Base-Analitica/DSHbanca/issues/3). A [issue #4](https://github.com/Base-Analitica/DSHbanca/issues/4) depende dela. Resultados históricos, CI, build ou mocks não comprovam esses gates no SHA final.

Consulte [AGENTS.md](AGENTS.md), a [arquitetura](docs/architecture.md) e o [protocolo de revisão](docs/ai-review-protocol.md). Esta política não certifica isolamento, integração DSH concluída ou reversibilidade de qualquer correção.

## Como Reportar um Problema

Se você encontrar um problema de segurança, por favor:

1. **Canal privado ainda não definido.** Recomenda-se fortemente definir um canal privado seguro (como um e-mail de segurança dedicado) antes de qualquer divulgação ou publicação pública.
2. **Não publique detalhes sensíveis em issue pública.**
3. **Para problemas não sensíveis**, é permitido abrir uma issue pública desde que não inclua segredo, token, exploit funcional ou dados privados.

## Dados que Não Devem ser Commitados

### Nunca commit:

- **Tokens**: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, etc.
- **Chaves de API**: qualquer string que comece com `sk-`, `pk-`, `api-`
- **Senhas**: qualquer campo `password`, `secret`, `token`
- **Caminhos sensíveis**: `/home/usuario/`, `C:\Users\`, etc.
- **Dados pessoais**: e-mails, CPFs, telefones, endereços
- **Manuscritos e evidências privadas**: TCCs, anexos, relatórios, snapshots e trechos acadêmicos sem autorização; não os publique em issues, prompts ou logs
- **Configurações locais**: `.env`, `credentials.json`, `config.local.json`

### Use variáveis de ambiente:

```bash
# Em vez de:
const apiKey = "sk-1234567890"

# Use:
const apiKey = process.env.OPENAI_API_KEY
```

### Use `.gitignore`:

O `.gitignore` já está configurado para ignorar:
- `.env` e `.env.*`
- `node_modules/`
- `dist/`
- `__pycache__/`
- `.venv/`
- etc.

## Cuidados com Tokens

1. **Nunca hardcode tokens** no código
2. **Use variáveis de ambiente** ou secrets do GitHub
3. **Rotacione tokens** regularmente
4. **Use tokens com escopo mínimo**
5. **Monitore uso de tokens**

## Cuidados com Prompts que Executam Comandos

O código acadêmico contém chamadas a processos externos (LaTeX, bibliografia e utilitários). Isso não comprova execução integrada no DSH. Cuidados exigidos:

1. **Valide entradas e caminhos** antes de executar
2. **Use allowlists** de comandos permitidos — `src/lib/latex.ts` constrói etapas apenas para `lualatex`, `xelatex`, `pdflatex`, `bibtex` e `biber`
3. **Evite shell strings** — nesse módulo, `runCommand` usa `spawnSync` com argumentos separados; isso não é garantia para todo subprocesso
4. **Não execute comandos de usuários não confiáveis**; revise ferramentas, dependências e conteúdo de documentos antes da execução
5. **Registre ações para auditoria**, sem segredos, conteúdo privado ou caminhos sensíveis
6. **Use timeouts e isolamento de processos** — `runCommand` define 120s por processo; timeout e argumentos separados não constituem sandbox nem isolamento comprovado no DSH

O confinamento de arquivos deve considerar traversal e symlinks, inclusive links quebrados. `src/lib/safe_paths.ts` faz validação lexical; `src/lib/state.ts` contém verificações de symlinks para armazenamento específico. Não presuma cobertura de toda leitura/escrita, ausência de condições de corrida ou sandbox a partir desses helpers. Verifique o caminho efetivo antes de ler, gravar, restaurar ou iniciar processo externo.

## Cuidados com Agentes Autônomos

Agentes de IA podem executar ações automaticamente. Cuidados:

1. **Limite o escopo** de ações permitidas
2. **Use guardrails** para proteger arquivos críticos
3. **Valide saídas** antes de aplicar
4. **Mantenha logs** de ações executadas
5. **Permita intervenção humana** quando necessário

O `banca-auditor` é **read-only**: não pode alterar manuscritos. Correções pelo `banca-corretor` exigem autorização humana específica, escopo definido e reversibilidade demonstrada (snapshot íntegro e restauração verificada), não apenas diretório de snapshot ou promessa de rollback. Preserve proveniência e evidências das mudanças. Identidade ausente ou não verificada não concede autorização; instruções Markdown não substituem controle técnico antes da mutação. O enforcement no DSH real continua sujeito aos gates acima; não autorize correções com base apenas nesta política.

## Dependências

1. **Mantenha dependências atualizadas**
2. **Verifique vulnerabilidades** periodicamente
3. **Use lockfile** (`bun.lock`) para reproduzibilidade
4. **Revise dependências novas** antes de adicionar

## MCPs e Execução Externa

MCPs (Model Context Protocol) e integrações gerais com serviços externos são responsabilidade do **DSH**, por seus contratos nativos: processo, autenticação, lifecycle, permissões e observabilidade pertencem ao host. Ao DSHbanca cabe apenas a interpretação acadêmica dos resultados, como matching de referências e proveniência.

O auto-registro e a configuração de MCP presentes no entry legado são **não suportados** como operação do DSHbanca. Não os habilite nem use outro harness para contornar gates pendentes. A presença do código não comprova integração MCP no DSH nem autoriza sua remoção antes de demonstrar equivalência nativa.

Antes de qualquer execução externa autorizada, revise a fonte e as dependências de terceiros, limite ambiente, credenciais, rede e acesso aos arquivos necessários e verifique descarte dos processos. São recomendações de segurança, não controles do host comprovados por este documento.

## Logs e Auditoria

1. **Não logge dados sensíveis**
2. **Mantenha logs de ações importantes**
3. **Use níveis de log apropriados**
4. **Rotacione logs** regularmente

## Verificação de Segredos

Use o script `scripts/check-secrets.sh` para detectar segredos no repositório:

```bash
# Modo CI (padrão) — varredura restrita; exclui parte da documentação
bash scripts/check-secrets.sh --ci

# Modo audit — varredura mais ampla; achados geram avisos, não reprovação
bash scripts/check-secrets.sh --audit
```

O modo `--ci` exclui `docs/`, `prompts/`, `SECURITY.md`, `README.md` e `CONTRIBUTING.md`, além de outras exclusões do script; portanto, CI verde **não significa que este arquivo foi varrido**. O modo `--audit` inclui esses documentos, mas mantém exclusões e retorna sucesso mesmo diante de possíveis segredos: investigue cada alerta. Ambos usam padrões heurísticos, podem omitir segredos ou sinalizar exemplos e **não substituem revisão humana** do diff e dos dados.

## Contato

Para questões de segurança:
- **Canal privado ainda não definido.** Recomenda-se definir um canal privado seguro antes de publicação/divulgação pública.
- Não publique detalhes sensíveis em issue pública.
- Para problemas não sensíveis, é permitido abrir uma issue pública sem incluir segredo, token, exploit funcional ou dados privados.
