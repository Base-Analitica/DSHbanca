# Changelog

Todas as mudanças relevantes serão documentadas aqui.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/),
e este projeto adere ao [Semantic Versioning](https://semver.org/lang/pt-BR/).

## [Unreleased]

### Corrigido

- Documentação de instalação ajustada para refletir pacote ainda não publicado (`private: true`)
- Matriz de validação alinhada com testes realmente executados (nada marcado como testado sem evidência)
- Compilação LaTeX ajustada para evitar execução via shell string (`execSync` → `spawnSync` com args separados)
- Auto-registro do MCP crossref-academic tornado explícito/opt-in (requer `OPENBANCA_AUTO_REGISTER_CROSSREF_MCP=1`)
- Script de verificação de segredos ajustado para reduzir falsos positivos (modo `--ci` ignora docs/prompts)

### Segurança

- Reduzido risco de execução shell na compilação LaTeX (validação de engines, argumentos separados)
- Auto-registro de dependência externa (crossref-academic via `uvx`) deixou de ser comportamento padrão
- Script check-secrets.sh: modo `--ci` detecta chaves reais sem falso positivo em documentação

### Alterado

- `src/lib/latex.ts`: `execSync` substituído por `spawnSync` com interface `LatexCommand`
- `src/tools/banca_compile.ts`: passos de compilação agora usam `LatexCommand[]` estruturado
- `src/index.ts`: auto-registro MCP protegido por variável de ambiente
- `scripts/check-secrets.sh`: dois modos (`--ci` e `--audit`)
- `docs/installation.md`: matriz de validação honesta, distinção local vs público
- `README.md`: seção de instalação corrigida
- `RELATORIO.md`: matriz de validação honesta
- `SECURITY.md`: seções de execução de comandos, MCPs e verificação de segredos

## [0.1.0] - 2025-01-XX

### Adicionado

- Plugin inicial para OpenCode
- 15 ferramentas para gestão de trabalhos acadêmicos
- Sistema de auditoria em 4 eixos
- Correção com guardrails
- Validação de referências via MCPs
- Detecção de padrões de IA
- Loop de correção contínua
- Snapshots para versionamento
- Compilação LaTeX
- Checklist de entrega
- 8 skills para workflows
- 5 agentes especializados
- Testes de integração

[Unreleased]: https://github.com/USUARIO/OpenBanca/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/USUARIO/OpenBanca/releases/tag/v0.1.0
