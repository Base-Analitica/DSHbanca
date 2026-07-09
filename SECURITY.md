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

O OpenBanca executa comandos via `execSync`. Cuidados:

1. **Validade entradas** antes de executar
2. **Use allowlists** de comandos permitidos
3. **Não execute comandos de usuários não confiáveis**
4. **Logge comandos executados** para auditoria
5. **Use timeouts** para evitar travamento

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

## Logs e Auditoria

1. **Não logge dados sensíveis**
2. **Mantenha logs de ações importantes**
3. **Use níveis de log apropriados**
4. **Rotacione logs** regularmente

## Contato

Para questões de segurança, entre em contato via:
- E-mail: [PENDENTE]
- Issue com tag `security` (para problemas não sensíveis)
