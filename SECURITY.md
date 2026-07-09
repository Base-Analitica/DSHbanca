# Política de Segurança

## Como Reportar um Problema

Se você encontrar um problema de segurança, por favor:

1. **Não abra uma issue pública** — isso expõe o problema
2. **Envie um e-mail** para [PENDENTE: definir e-mail de segurança]
3. **Descreva o problema** com detalhes suficientes para reprodução
4. **Aguarde resposta** antes de divulgar publicamente

## Dados que Não Devem ser Commitados

### Nunca commit:

- **Tokens**: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, etc.
- **Chaves de API**: qualquer string que comece com `sk-`, `pk-`, `api-`
- **Senhas**: qualquer campo `password`, `secret`, `token`
- **Caminhos sensíveis**: `/home/usuario/`, `C:\Users\`, etc.
- **Dados pessoais**: e-mails, CPFs, telefones, endereços
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

O OpenBanca executa comandos externos (LaTeX, bibliografia, MCPs). Cuidados:

1. **Validade entradas** antes de executar
2. **Use allowlists** de comandos permitidos — engines LaTeX são validados contra lista fixa (`lualatex`, `xelatex`, `pdflatex`)
3. **Evite shell strings** — comandos são executados via `spawnSync` com argumentos separados, não via `execSync`
4. **Não execute comandos de usuários não confiáveis**
5. **Logge comandos executados** para auditoria
6. **Use timeouts** para evitar travamento (120s para compilação LaTeX)

## Cuidados com Agentes Autônomos

Agentes de IA podem executar ações automaticamente. Cuidados:

1. **Limite o escopo** de ações permitidas
2. **Use guardrails** para proteger arquivos críticos
3. **Valide saídas** antes de aplicar
4. **Mantenha logs** de ações executadas
5. **Permita intervenção humana** quando necessário

## Dependências

1. **Mantenha dependências atualizadas**
2. **Verifique vulnerabilidades** periodicamente
3. **Use lockfile** (`bun.lock`) para reproduzibilidade
4. **Revise dependências novas** antes de adicionar

## MCPs e Execução Externa

O OpenBanca pode utilizar MCPs (Model Context Protocol) para validação de referências acadêmicas:

- O MCP `crossref-academic` invoca `uvx` para baixar e executar código Python de terceiros
- Por padrão, o plugin **não registra MCPs automaticamente**
- Para habilitar o auto-registro experimental, defina `OPENBANCA_AUTO_REGISTER_CROSSREF_MCP=1`
- Revise a fonte do MCP antes de ativar o auto-registro
- Considere configurar MCPs manualmente em `opencode.json` em vez de usar auto-registro

## Logs e Auditoria

1. **Não logge dados sensíveis**
2. **Mantenha logs de ações importantes**
3. **Use níveis de log apropriados**
4. **Rotacione logs** regularmente

## Verificação de Segredos

Use o script `scripts/check-secrets.sh` para detectar segredos no repositório:

```bash
# Modo CI (padrão) — falha apenas com achados fortes (chaves reais, arquivos .env, .pem)
bash scripts/check-secrets.sh --ci

# Modo audit — scan amplo para revisão, não falha com termos genéricos em docs
bash scripts/check-secrets.sh --audit
```

## Contato

Para questões de segurança, entre em contato via:
- E-mail: [PENDENTE]
- Issue com tag `security` (para problemas não sensíveis)
