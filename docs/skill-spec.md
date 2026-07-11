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

O OpenCode exige obrigatoriamente um bloco de `frontmatter` YAML no topo do `SKILL.md`, contendo regras rígidas para descoberta do Agent Skills.

```markdown
---
name: banca-nome-da-skill
description: Descrição específica, não vazia e semanticamente útil da skill.
---
# Skill: Nome da Skill

A descrição no frontmatter ajuda o Agente a decidir quando utilizar a skill. Não declare capacidades que o código não possui.

## Ativação

Como invocar a skill.

## Protocolo

1. Passo 1
2. Passo 2
3. ...

## Saída

O que a skill produz.
```

### Campos do Frontmatter

O OpenCode reconhece os seguintes campos no frontmatter das skills:

- `name`
- `description`
- `license`
- `compatibility`
- `metadata`

**Regras estritas:**
- **`name`**: Obrigatório. 1 a 64 caracteres. Deve corresponder exatamente ao nome do diretório e seguir a regex `^[a-z0-9]+(-[a-z0-9]+)*$`.
- **`description`**: Obrigatório. 1 a 1024 caracteres. Descreve sucintamente a skill para a heurística de roteamento do OpenCode.

## Descoberta e Carregamento

### Como uma skill é descoberta
Uma skill é descoberta pelo OpenCode analisando o diretório de skills configurado no projeto (ex: `.opencode/skills/`). O OpenCode identifica cada subdiretório e lê o respectivo `SKILL.md`. Para a descoberta funcionar, o frontmatter YAML deve ser válido e o `name` no frontmatter deve bater com o nome da pasta. Arquivos copiados sem esse formato estrito falham silenciosamente e não são disponibilizados para o agente.

### Como carregar pela ferramenta `skill`
Após inicializar o projeto com `/banca-init`, a ferramenta nativa `skill` do OpenCode pode ser usada para carregar o workflow.
Para invocar uma skill, você deve passar o `name` da skill (exemplo: `name: "banca-avaliacao"`), e não um nome de agente.

**Nota Importante:** O nome carregado na ferramenta `skill` deve ser o nome da skill (`banca-avaliacao`, por exemplo). `@banca-auditor` é um agente, não uma skill. Você interage com `@banca-auditor` pelo chat para pedir que o agente trabalhe, mas quando se usa a ferramenta programática `skill`, deve-se informar o identificador da skill.

## Procedimento de Verificação no OpenCode
Ao testar no OpenCode:
1. Crie um projeto temporário.
2. Rode `/banca-init`.
3. Abra o OpenCode e certifique-se de que as 8 skills aparecem disponíveis no contexto.
4. Chame a ferramenta `skill` com `name: "banca-avaliacao"`.
5. Verifique se o conteúdo correto foi carregado.

## Skills Disponíveis

### banca-avaliacao
**Função:** Avalia monografias nos eixos ABNT, citações, conteúdo e estilo.
**Arquivo:** `assets/opencode/skills/banca-avaliacao/SKILL.md`

### banca-correcao
**Função:** Aplica correções ao manuscrito com proteção de guardrails.
**Arquivo:** `assets/opencode/skills/banca-correcao/SKILL.md`

### banca-detector-ia
**Função:** Analisa padrões estilísticos sinalizados pela heurística interna e produz uma triagem não conclusiva, sem determinar autoria por IA.
**Arquivo:** `assets/opencode/skills/banca-detector-ia/SKILL.md`

### banca-grille
**Função:** Executa entrevista ou clarificação com o usuário antes de aplicar alterações complexas.
**Arquivo:** `assets/opencode/skills/banca-grille/SKILL.md`

### banca-plagio
**Função:** Verificação de plágio via CopySpider.
**Arquivo:** `assets/opencode/skills/banca-plagio/SKILL.md`

### banca-planejador
**Função:** Planeja correções com base na auditoria.
**Arquivo:** `assets/opencode/skills/banca-planejador/SKILL.md`

### banca-referencias
**Função:** Valida referências bibliográficas.
**Arquivo:** `assets/opencode/skills/banca-referencias/SKILL.md`

### banca-revisor
**Função:** Revisa o diff das correções aplicadas para bloquear regressões e proteger dados.
**Arquivo:** `assets/opencode/skills/banca-revisor/SKILL.md`

## Convenções de Nome

- **Skills**: `banca-{nome}` (lowercase, kebab-case)
- **Agentes**: `banca-{nome}` (lowercase, kebab-case)
- **Tools**: `banca_{nome}` (lowercase, snake_case)
- **Comandos**: `/banca:{nome}` (lowercase, snake_case)
