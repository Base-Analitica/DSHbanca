# Instalação (guia rápido)

Este é um guia de **preparação local do repositório**, não de instalação funcional no host. Consulte [installation.md](installation.md) para o estado da integração, fontes e limites de evidência.

## Pré-requisitos

- **Git e Bun** para os comandos abaixo. A CI fixa Bun `1.3.9`; isso não estabelece uma versão mínima suportada.
- **DSH (DeepSeek Harness)/Cordis** é o destino exclusivo da integração, mas não precisa ser iniciado para preparar o repositório. A versão mínima de DSH **não foi validada**.
- LaTeX é opcional para trabalho futuro de compilação de manuscritos; não é necessário neste preparo.

## Preparo local

```bash
git clone https://github.com/Base-Analitica/DSHbanca.git
cd DSHbanca
bun install --frozen-lockfile
bun run build
```

Clone e resolução de dependências podem exigir rede. Este preparo não exige modelo, credenciais de provedor nem MCP externo.

**Instalar dependências e compilar não instala funcionalmente o plugin no DSH**, não registra o bundle no host e não comprova discovery ou dispatch.

## Estado e próximo gate

O pacote `dshbanca` é experimental (`0.1.0`), `private: true` e `UNLICENSED`, sem publicação oficial, release autorizada ou fluxo final de instalação/uso validado. **Não há comando CLI do DSH de instalação validado a recomendar.**

A `master` incorpora a integração nativa: export `./dsh`, [patch Cordis](../cordis.patch.yml) com `dshbanca/dsh` e preset `banca-auditor`, 16 ferramentas registradas via `ctx.tools.register`, guard deny-only read-only do auditor, provider nativo das 8 skills e o script `e2e:dsh:profile`. A [PR #1](https://github.com/Base-Analitica/DSHbanca/pull/1) foi integrada (merge `820910f8cb0eb93e5bc0090040b9cde601de397e`, 29/10/2026) e a [issue #3](https://github.com/Base-Analitica/DSHbanca/issues/3) está encerrada; os estados de draft/`CHANGES_REQUESTED` e de bloqueio da #3 são **históricos e foram superados**.

A evidência nativa sem modelo foi observada em SHAs específicos — `cb066a10d9bf88af0be5eb832eb794de44e0383d` (PR #1), `aa39d371962f8cb1349af19fbc6acba78f4f4a85` (PR #49) e os HEADs das verticais 01–05 (#99, #101, #104, #106, #108) — e não comprova o HEAD atual nem se transfere para um novo commit. Detalhes, SHAs e limites estão no [guia detalhado](installation.md#evidências-nativas-e-limites). CI convencional não substitui E2E DSH: a etapa nativa da CI só executa com `DSH_PROFILE_E2E_ENABLED=true` e, sem host provisionado, registra `BLOCKED`.

O que continua ausente: canal oficial de distribuição e procedimento final de instalação para usuários; UX Web interativa; comportamento com modelo; e os gates próprios das [issue #4](https://github.com/Base-Analitica/DSHbanca/issues/4)/[#74](https://github.com/Base-Analitica/DSHbanca/issues/74)/[#75](https://github.com/Base-Analitica/DSHbanca/issues/75), [#62](https://github.com/Base-Analitica/DSHbanca/issues/62), [#23](https://github.com/Base-Analitica/DSHbanca/issues/23), [#50](https://github.com/Base-Analitica/DSHbanca/issues/50), [#102](https://github.com/Base-Analitica/DSHbanca/issues/102)/[PR #125](https://github.com/Base-Analitica/DSHbanca/pull/125) e [#124](https://github.com/Base-Analitica/DSHbanca/issues/124); a [issue-mãe #109](https://github.com/Base-Analitica/DSHbanca/issues/109) permanece aberta. O encerramento da #3 não desbloqueia esses itens.

OpenBanca é outro projeto, voltado ao OpenCode; orientações desse legado **não são suportadas** aqui. Não use a suíte integral sem o preflight de segurança descrito no [guia detalhado](installation.md).

Referências: [README](../README.md), [governança](../AGENTS.md), [arquitetura](architecture.md), [gate E2E](dsh-profile-e2e.md) e [evidências nativas](installation.md#evidências-nativas-e-limites).
