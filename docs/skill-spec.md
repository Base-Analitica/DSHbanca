# Especificação das Skills

## Visão Geral

Skills no OpenBanca são workflows orquestrados que combinam múltiplas ferramentas para realizar tarefas complexas. Cada skill é definida em um arquivo `SKILL.md` dentro de um diretório próprio.

## Formato de uma Skill

### Estrutura de Diretório

```
assets/opencode/skills/
├── banca-avaliacao/
│   └── SKILL.md
├── banca-correcao/
│   └── SKILL.md
└── ...
```

### Formato do Arquivo SKILL.md

```markdown
# Skill: Nome da Skill

Descrição curta do que a skill faz.

## Ativação

Como invocar a skill (agente, comando, etc.).

## Protocolo

1. Passo 1
2. Passo 2
3. ...

## Configuração (opcional)

Parâmetros específicos da skill.

## Saída

O que a skill produz.
```

## Skills Disponíveis

### banca-avaliacao

**Arquivo:** `assets/opencode/skills/banca-avaliacao/SKILL.md`

**Função:** Avalia monografias nos eixos ABNT, citações, conteúdo e estilo.

**Ativação:** Invocar agente `@banca-auditor`.

**Protocolo:**
1. Carregar contexto via `banca_context`
2. Executar `banca_auditar` para métricas objetivas
3. Avaliar cada eixo com base no contexto e nas métricas
4. Gerar parecer textual por eixo
5. Delegar ao integrador para nota final

**Rubrica (perfil `banca-rigorosa`):**
- ABNT/Estrutura: peso 3
- Citações/Fontes: peso 3
- Conteúdo/Lógica: peso 2
- Estilo Acadêmico: peso 2

**Travas:**
- >30% parágrafos sem citação → nota máxima 4.0
- Ficha catalográfica caseira (sem CRB) → nota máxima 6.0
- Conclusão rotulada como "Conclusão" em vez de "Considerações Finais" → nota máxima 6.0

**Saída:** Relatório markdown em `.banca/reports/`.

### banca-correcao

**Arquivo:** `assets/opencode/skills/banca-correcao/SKILL.md`

**Função:** Aplica correções ao manuscrito com proteção de guardrails.

### banca-detector-ia

**Arquivo:** `assets/opencode/skills/banca-detector-ia/SKILL.md`

**Função:** Detecta padrões heurísticos de IA no texto.

### banca-grille

**Arquivo:** `assets/opencode/skills/banca-grille/SKILL.md`

**Função:** Grade de avaliação para padronizar correções.

### banca-plagio

**Arquivo:** `assets/opencode/skills/banca-plagio/SKILL.md`

**Função:** Verificação de plágio via CopySpider.

### banca-planejador

**Arquivo:** `assets/opencode/skills/banca-planejador/SKILL.md`

**Função:** Planeja correções com base na auditoria.

### banca-referencias

**Arquivo:** `assets/opencode/skills/banca-referencias/SKILL.md`

**Função:** Valida referências bibliográficas.

### banca-revisor

**Arquivo:** `assets/opencode/skills/banca-revisor/SKILL.md`

**Função:** Revisão acadêmica abrangente.

## Convenções de Nome

- **Skills**: `banca-{nome}` (lowercase, kebab-case)
- **Agentes**: `banca-{nome}` (lowercase, kebab-case)
- **Tools**: `banca_{nome}` (lowercase, snake_case)
- **Comandos**: `/banca:{nome}` (lowercase, snake_case)

## Como Adicionar Nova Skill

1. Criar diretório em `assets/opencode/skills/{nome-skill}/`
2. Criar arquivo `SKILL.md` seguindo o formato acima
3. Se a skill requer nova tool, criar em `src/tools/`
4. Registrar a tool em `src/index.ts`
5. Adicionar import lazy no entry point
6. Criar agente correspondente em `assets/opencode/agents/` (se necessário)
7. Documentar em `docs/skill-spec.md`
8. Criar teste em `tests/`

## Como Revisar uma Skill

1. Verificar se o `SKILL.md` está completo
2. Verificar se a skill invoca tools corretas
3. Verificar se a saída é clara e útil
4. Verificar se há guardrails adequados
5. Verificar se a skill está documentada
6. Executar testes associados
