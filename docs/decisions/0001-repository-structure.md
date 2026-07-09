# Decisão: Estrutura do Repositório

## Status

Aceita

## Contexto

O projeto OpenBanca é um plugin OpenCode para gestão de trabalhos acadêmicos. Precisamos organizar o repositório para:
- Ser fácil de entender por humanos e IAs
- Ser seguro para versionamento público
- Ser reproduzível e auditável
- Manter compatibilidade com o OpenCode

## Decisão

Mantivemos a estrutura original do projeto (src/, assets/, docs/, tests/) e adicionamos arquivos de suporte para GitHub (README, CONTRIBUTING, SECURITY, etc.).

### Estrutura Final

```
Openbanca/
├── README.md                    # Documentação principal
├── CHANGELOG.md                 # Histórico de mudanças
├── ROADMAP.md                   # Plano de desenvolvimento
├── CONTRIBUTING.md              # Guia de contribuição
├── SECURITY.md                  # Política de segurança
├── LICENSE_PENDING.md           # Licença (pendente)
├── .gitignore                   # Arquivos ignorados
├── .editorconfig                # Configuração de edição
├── package.json                 # Dependências
├── tsconfig.json                # Configuração TypeScript
├── bun.lock                     # Lockfile
├── docs/                        # Documentação técnica
│   ├── overview.md
│   ├── installation.md
│   ├── usage.md
│   ├── architecture.md
│   ├── skill-spec.md
│   ├── ai-review-protocol.md
│   ├── troubleshooting.md
│   └── decisions/
├── src/                         # Código fonte (inalterado)
├── assets/                      # Assets OpenCode (inalterado)
├── tests/                       # Testes (inalterado)
├── prompts/                     # Prompts para revisão IA
├── scripts/                     # Scripts de validação
└── .github/                     # Templates GitHub
```

## Alternativas Consideradas

### Alternativa 1: Reorganizar tudo

**Proposta:** Mover arquivos para nova estrutura (ex: packages/, plugins/, etc.)

**Rejeitada porque:**
- Quebraria compatibilidade com o OpenCode
- Exigiria atualizar imports e configs
- Aumentaria risco de erros
- Não traria benefício proporcional

### Alternativa 2: Monorepo com múltiplos pacotes

**Proposta:** Criar packages separados para tools, lib, assets

**Rejeitada porque:**
- Projeto ainda é pequeno (v0.1.0)
- Complexidade desnecessária para fase experimental
- OpenCode espera plugin único

### Alternativa 3: Manter estrutura original

**Proposta:** Apenas adicionar arquivos de suporte sem mover nada

**Escolhida porque:**
- Zero risco de quebra
- Mantém compatibilidade
- Fácil de revisar (diff mínimo)
- Documenta a estrutura existente

## Consequências

### Positivas
- Nenhuma quebra de compatibilidade
- Revisão fácil (poucas mudanças)
- Documentação clara da estrutura atual

### Negativas
- Estrutura pode não ser "ideal" para todos
- Alguma redundância (docs/ existente + novo docs/)
- `dist/` e `node_modules/` precisam ser gitignored

## O que Ainda Precisa ser Confirmado

1. **Compatibilidade com OpenCode**: Testar se o plugin funciona após adicionar arquivos
2. **Tamanho do repositório**: Verificar se `dist/` e `node_modules/` são gitignored corretamente
3. **Licença**: Definir licença antes de tornar público
4. **CI/CD**: Configurar pipeline de validação automática
