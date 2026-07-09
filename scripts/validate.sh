#!/bin/bash

# Script de validação do repositório OpenBanca
# Verifica se os arquivos essenciais existem e estão corretos

set -e

echo "=== Validação do Repositório OpenBanca ==="
echo ""

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

errors=0
warnings=0

# Função para verificar arquivo
check_file() {
    local file=$1
    local description=$2
    local required=${3:-true}
    
    if [ -f "$file" ]; then
        echo -e "${GREEN}✓${NC} $description: $file"
    elif [ "$required" = "true" ]; then
        echo -e "${RED}✗${NC} $description: $file (OBRIGATÓRIO)"
        errors=$((errors + 1))
    else
        echo -e "${YELLOW}⚠${NC} $description: $file (opcional)"
        warnings=$((warnings + 1))
    fi
}

# Função para verificar diretório
check_dir() {
    local dir=$1
    local description=$2
    local required=${3:-true}
    
    if [ -d "$dir" ]; then
        echo -e "${GREEN}✓${NC} $description: $dir"
    elif [ "$required" = "true" ]; then
        echo -e "${RED}✗${NC} $description: $dir (OBRIGATÓRIO)"
        errors=$((errors + 1))
    else
        echo -e "${YELLOW}⚠${NC} $description: $dir (opcional)"
        warnings=$((warnings + 1))
    fi
}

# Verificar arquivos principais
echo "=== Arquivos Principais ==="
check_file "README.md" "Documentação principal"
check_file "CHANGELOG.md" "Histórico de mudanças"
check_file "ROADMAP.md" "Plano de desenvolvimento"
check_file "CONTRIBUTING.md" "Guia de contribuição"
check_file "SECURITY.md" "Política de segurança"
check_file "LICENSE_PENDING.md" "Licença"
check_file ".gitignore" "Arquivos ignorados"
check_file ".editorconfig" "Configuração de edição"
check_file "package.json" "Dependências"
check_file "tsconfig.json" "Configuração TypeScript"
check_file "bun.lock" "Lockfile"
echo ""

# Verificar documentação
echo "=== Documentação ==="
check_dir "docs" "Diretório de documentação"
check_file "docs/overview.md" "Visão geral"
check_file "docs/installation.md" "Guia de instalação"
check_file "docs/usage.md" "Guia de uso"
check_file "docs/architecture.md" "Arquitetura"
check_file "docs/skill-spec.md" "Especificação das skills"
check_file "docs/ai-review-protocol.md" "Protocolo de revisão IA"
check_file "docs/troubleshooting.md" "Solução de problemas"
check_dir "docs/decisions" "Decisões de design"
echo ""

# Verificar prompts
echo "=== Prompts para Revisão IA ==="
check_dir "prompts" "Diretório de prompts"
check_file "prompts/ai-reviewer-general.md" "Prompt revisão geral"
check_file "prompts/ai-reviewer-code.md" "Prompt revisão de código"
check_file "prompts/ai-reviewer-docs.md" "Prompt revisão de documentação"
check_file "prompts/ai-reviewer-security.md" "Prompt revisão de segurança"
echo ""

# Verificar scripts
echo "=== Scripts ==="
check_dir "scripts" "Diretório de scripts"
check_file "scripts/validate.sh" "Script de validação"
check_file "scripts/check-secrets.sh" "Script de verificação de segredos"
echo ""

# Verificar GitHub
echo "=== GitHub ==="
check_dir ".github" "Diretório GitHub"
check_file ".github/PULL_REQUEST_TEMPLATE.md" "Template de PR"
check_dir ".github/ISSUE_TEMPLATE" "Templates de issues"
echo ""

# Verificar código fonte
echo "=== Código Fonte ==="
check_dir "src" "Diretório de código fonte"
check_file "src/index.ts" "Entry point"
check_dir "src/lib" "Bibliotecas"
check_dir "src/tools" "Ferramentas"
echo ""

# Verificar testes
echo "=== Testes ==="
check_dir "tests" "Diretório de testes"
check_file "tests/integration.test.ts" "Testes de integração"
echo ""

# Verificar arquivos que devem ser ignorados
echo "=== Verificação de Gitignore ==="
if grep -q "node_modules" .gitignore 2>/dev/null; then
    echo -e "${GREEN}✓${NC} node_modules está no .gitignore"
else
    echo -e "${RED}✗${NC} node_modules NÃO está no .gitignore"
    errors=$((errors + 1))
fi

if grep -q "dist" .gitignore 2>/dev/null; then
    echo -e "${GREEN}✓${NC} dist está no .gitignore"
else
    echo -e "${RED}✗${NC} dist NÃO está no .gitignore"
    errors=$((errors + 1))
fi

if grep -q ".env" .gitignore 2>/dev/null; then
    echo -e "${GREEN}✓${NC} .env está no .gitignore"
else
    echo -e "${RED}✗${NC} .env NÃO está no .gitignore"
    errors=$((errors + 1))
fi
echo ""

# Verificar JSON válido
echo "=== Validação de JSON ==="
if command -v node &> /dev/null; then
    if node -e "JSON.parse(require('fs').readFileSync('package.json', 'utf8'))" 2>/dev/null; then
        echo -e "${GREEN}✓${NC} package.json é JSON válido"
    else
        echo -e "${RED}✗${NC} package.json é JSON inválido"
        errors=$((errors + 1))
    fi
    
    if node -e "JSON.parse(require('fs').readFileSync('tsconfig.json', 'utf8'))" 2>/dev/null; then
        echo -e "${GREEN}✓${NC} tsconfig.json é JSON válido"
    else
        echo -e "${RED}✗${NC} tsconfig.json é JSON inválido"
        errors=$((errors + 1))
    fi
else
    echo -e "${YELLOW}⚠${NC} Node.js não encontrado, pulando validação de JSON"
    warnings=$((warnings + 1))
fi
echo ""

# Resumo
echo "=== Resumo ==="
if [ $errors -eq 0 ]; then
    echo -e "${GREEN}✓ Validação concluída com sucesso!${NC}"
    echo "  - $warnings avisos"
    exit 0
else
    echo -e "${RED}✗ Validação falhou com $errors erros${NC}"
    echo "  - $warnings avisos"
    exit 1
fi
