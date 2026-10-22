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

O pacote `dshbanca` é `private: true` e `UNLICENSED`, sem publicação oficial nem fluxo de instalação/uso final validado. Não há comando CLI DSH de instalação validado a recomendar.

A `master` declara export `./dsh`, patch Cordis e provider de skills. As 16 ferramentas nativas, o guard e o gate E2E são propostas da [PR #1](https://github.com/Base-Analitica/DSHbanca/pull/1), ainda **draft/CHANGES_REQUESTED**, não funcionalidades incorporadas. O consumo Markdown do auditor segue bloqueado na [issue #3](https://github.com/Base-Analitica/DSHbanca/issues/3); evidência de SHA anterior não comprova o HEAD final.

OpenBanca é outro projeto, voltado ao OpenCode; orientações desse legado **não são suportadas** aqui. Não use a suíte integral sem o preflight de segurança descrito no [guia detalhado](installation.md).

Referências: [README](../README.md), [governança](../AGENTS.md) e [arquitetura](architecture.md).
