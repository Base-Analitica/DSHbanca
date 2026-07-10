# Ambiente OpenCode no Jules

Este documento registra o ambiente usado por tarefas do Jules que precisam validar o OpenBanca contra um cliente real do OpenCode.

## Estado validado

Validação realizada em **10 de julho de 2026** no ambiente de Initial Setup do Jules:

- OpenCode observado: `1.17.18`
- Binário observado: `/home/jules/.local/bin/opencode`
- Node.js observado: `v22.22.1`
- Bun observado: `1.2.14`

O setup conseguiu executar com sucesso:

```bash
/home/jules/.local/bin/opencode --version
/home/jules/.local/bin/opencode --help
```

Também foi executado:

```bash
NO_COLOR=1 /home/jules/.local/bin/opencode debug skill
```

O comando alcançou o parser real do OpenCode e rejeitou um frontmatter inválido em `.opencode/agents/banca-fontes.md`. Isso comprova que o binário está disponível para testes reais de integração. Não comprova que o bundle completo do OpenBanca está aprovado.

## Preflight obrigatório em cada tarefa

O snapshot e a versão instalada podem mudar. Toda tarefa que dependa do OpenCode deve começar com:

```bash
set -euo pipefail

OPENCODE_BIN="$(command -v opencode || true)"

if [ -z "$OPENCODE_BIN" ] || [ ! -x "$OPENCODE_BIN" ]; then
  if [ -x /home/jules/.local/bin/opencode ]; then
    OPENCODE_BIN=/home/jules/.local/bin/opencode
  fi
fi

if [ -z "$OPENCODE_BIN" ] || [ ! -x "$OPENCODE_BIN" ]; then
  echo "OpenCode não está disponível nesta task." >&2
  exit 1
fi

"$OPENCODE_BIN" --version
```

A tarefa deve registrar o caminho e a versão efetivamente usados. Não deve assumir que `1.17.18` continuará sendo a versão presente no futuro.

## Testes que não precisam de modelo

O binário pode ser usado sem chave de API para:

- validar configurações e frontmatter pelo parser real do OpenCode;
- testar descoberta e carregamento de skills;
- testar leitura de agentes e comandos;
- validar assets materializados em um projeto temporário;
- executar comandos de diagnóstico, como `opencode debug skill`.

Esses testes devem preferir um diretório criado com `mktemp -d` e não devem modificar o repositório quando o escopo for apenas diagnóstico.

## Testes que precisam de modelo

Testes comportamentais podem exigir um modelo disponível, por exemplo:

- executar `opencode run`;
- verificar se o agente seleciona uma skill;
- verificar chamadas de ferramentas;
- avaliar se o protocolo da skill foi seguido.

Quando necessário, a chave do OpenCode Zen deve ser fornecida somente pelo campo seguro de variáveis de ambiente do Jules:

```text
OPENCODE_API_KEY
```

Nunca grave a chave em:

- arquivos do repositório;
- prompts versionados;
- scripts de setup;
- logs;
- relatórios de teste;
- arquivos `.env` versionados.

Não execute `env`, `printenv` ou comandos equivalentes que possam expor segredos.

## Separação entre setup e tarefa

O **Initial Setup** tem apenas a responsabilidade de preparar o snapshot e disponibilizar o OpenCode.

A **tarefa do Jules** tem a responsabilidade de:

1. confirmar o binário e a versão;
2. confirmar branch e SHA testados;
3. preparar o projeto temporário;
4. executar o fluxo real do OpenBanca;
5. executar o teste de integração;
6. registrar stdout, stderr, códigos de saída e limitações.

Não coloque testes específicos do OpenBanca no script de Initial Setup.

## Evidência histórica

Na branch `fix-skills-frontmatter-5724788138891458986`, SHA `b8f914b3d46fa8b3431f7b4d3da1dee70d0da5cc`, o fluxo real `installAssets(projectRoot, true)` criou os assets com sucesso. Em seguida, o OpenCode `1.17.18` encerrou `debug skill` com código `1` porque o campo `tools` de um agente estava representado como uma lista YAML, enquanto o OpenCode esperava um objeto.

Interpretação correta daquele diagnóstico:

- instalação dos assets: aprovada;
- disponibilidade do OpenCode: aprovada;
- inicialização do projeto no OpenCode: falhou;
- descoberta das skills: bloqueada e não concluída;
- comportamento de LLM: não testado.

Essa evidência serve como histórico. Tarefas futuras devem sempre testar novamente o estado atual do código.
