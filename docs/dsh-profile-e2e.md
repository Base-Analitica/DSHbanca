# Gate E2E de perfil nativo DSH

O comando `bun run e2e:dsh:profile` exercita o mecanismo real do DSH instalado, sem iniciar agente, enviar prompt ao SDK ou chamar modelo. O gate cria um perfil `sdk` temporário, instala o checkout e um observador temporário usando `dsh plugin --profile ... add --offline`, inspeciona a composição efetiva e inicia o perfil pela CLI DSH. O observador consulta `ctx.tools.schemas()` e `ctx.skills.list()`, cria uma sessão vazia real do `SessionStore` apenas para fornecer o workspace ao `ToolRuntime`, e executa `banca_init` e `banca_status` através de `ctx.tools.execute()`.

## Pré-requisitos

- DSH instalado e executável no `PATH` (ou `DSH_BIN` apontando para um executável DSH real).
- Node e Bun executáveis no `PATH`.
- O pacote `pnpm.cjs` já disponível em um cache Corepack local offline (ou `PNPM_BIN` apontando diretamente para esse arquivo). O gate não baixa pnpm nem libera acesso à rede.
- Dependências do checkout instaladas pelo fluxo normal do projeto.

O gate usa o SDK profile fornecido pelo DSH `dsh --profile <nome> --from-default-profile sdk --dump-config`, instala somente diretórios locais via `dsh plugin --profile <nome> add --offline --store-dir <sandbox> <checkout> <observador>`, e inicia o perfil com `dsh --profile <nome> --patch <overlay>`. A instalação/boot são limitados por timeout; os processos são iniciados em grupo e encerrados se excederem o limite.

## Isolamento e relatório

Cada execução cria um diretório aleatório com permissões restritas e configura `DSH_HOME`, `HOME`, `TMPDIR`, diretórios XDG, cache/config do npm, `PNPM_HOME`, store pnpm e Corepack para subdiretórios desse sandbox. `DSH_TELEMETRY_MODE=DISABLED` evita exportação de telemetria. O DSH global é apenas executado para uso da CLI e leitura de módulos; perfil, pacote observer, projeto LaTeX/BibTeX, estado e store de pacotes são temporários. O pacote pnpm é chamado diretamente de sua cópia cacheada por um wrapper privado do sandbox, evitando escrita no estado global do Corepack. `pnpm --offline` e `COREPACK_ENABLE_NETWORK=0` impedem download. O gate compara o estado Git do checkout antes e depois do boot para detectar escrita fora do sandbox no repositório.

O relatório sanitizado e persistente fica em `docs/evidence/dsh-profile-e2e.latest.json`. Ele registra SHA, versões, códigos de saída, bundles anteriores/posteriores, composição Cordis, os nomes das ferramentas, skill, inventário SHA-256 relativo do projeto sintético, comportamento read-only e limpeza. Caminhos absolutos e saída bruta do host não são armazenados; em falhas, somente um trecho curto com caminhos conhecidos redigidos é preservado para diagnóstico.

## Status e interpretação

- `PASS` / exit code `0`: instalação, composição, boot real, descoberta exata das 16 ferramentas, skill, execução e hashes passaram, e o sandbox foi removido.
- `FAIL` / exit code `1`: o DSH estava disponível, mas uma etapa de execução ou asserção violou o contrato.
- `BLOCKED` / exit code `2`: DSH, runtime ou pnpm offline necessário não está disponível. Ausência do DSH jamais é um teste aprovado.

O CI geral do repositório não provisiona nem instala DSH. Ele emite um aviso explícito `BLOCKED` e não conta essa etapa como validação quando a variável de repositório `DSH_PROFILE_E2E_ENABLED` não é `true`. Defina a variável como `true` somente para um runner provisionado com DSH e cache pnpm offline. Nesse runner o gate é obrigatório: se DSH estiver ausente, o comando retorna `BLOCKED` com código diferente de zero. Os testes de contrato em `tests/e2e_dsh_profile_contract.test.ts` exercitam as rejeições locais para composição incompleta, entrypoint, tool/skill ausentes, execução omitida, mutação inesperada e hashes divergentes, mas não substituem o gate de perfil DSH real.

## Limites

Este teste comprova perfil Cordis e ToolRuntime real, com contexto de workspace sintético. Ele não comprova sessão de agente, tool loop, inferência de modelo, guard através de identidade de agente real, validação humana, nem persistência/retomada de uma conversa. Nenhuma dessas etapas é invocada pelo gate.
