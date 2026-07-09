#!/bin/bash

# Script de verificação de segredos no repositório
# Procura por padrões óbvios de dados sensíveis

set -e

echo "=== Verificação de Segredos ==="
echo ""

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

found=0

# Padrões para buscar
patterns=(
    "OPENAI_API_KEY"
    "ANTHROPIC_API_KEY"
    "GITHUB_TOKEN"
    "sk-[a-zA-Z0-9]"
    "\.env"
    "password"
    "token"
    "secret"
    "api_key"
    "apikey"
    "private_key"
)

# Arquivos para ignorar
ignore_dirs=(
    "node_modules"
    ".git"
    "dist"
    "_original_snapshot"
)

# Construir comando find
find_cmd="find . -type f"
for dir in "${ignore_dirs[@]}"; do
    find_cmd="$find_cmd -not -path \"./$dir/*\""
done
find_cmd="$find_cmd -not -name \".gitignore\""

echo "Procurando por padrões sensíveis..."
echo ""

for pattern in "${patterns[@]}"; do
    # Usar grep com -r para buscar recursivamente
    results=$(grep -r -l -i "$pattern" --include="*.ts" --include="*.js" --include="*.json" --include="*.md" --include="*.yaml" --include="*.yml" --include="*.env" . 2>/dev/null | grep -v "node_modules" | grep -v ".git" | grep -v "dist" || true)
    
    if [ -n "$results" ]; then
        echo -e "${YELLOW}⚠ Padrão encontrado: $pattern${NC}"
        echo "$results" | while read -r file; do
            echo "  - $file"
            # Mostrar a linha com o padrão
            grep -n -i "$pattern" "$file" 2>/dev/null | head -3 | while read -r line; do
                echo "    $line"
            done
        done
        echo ""
        found=$((found + 1))
    fi
done

# Verificar arquivos .env
echo "=== Verificando arquivos .env ==="
env_files=$(find . -name "*.env" -o -name ".env*" 2>/dev/null | grep -v "node_modules" | grep -v ".git" || true)
if [ -n "$env_files" ]; then
    echo -e "${RED}✗ Arquivos .env encontrados:${NC}"
    echo "$env_files" | while read -r file; do
        echo "  - $file"
    done
    echo ""
    echo -e "${YELLOW}Recomendação: Adicione ao .gitignore e não commit este arquivo${NC}"
    found=$((found + 1))
else
    echo -e "${GREEN}✓ Nenhum arquivo .env encontrado${NC}"
fi
echo ""

# Verificar chaves privadas
echo "=== Verificando chaves privadas ==="
key_files=$(find . -name "*.pem" -o -name "*.key" -o -name "*.p12" -o -name "*.pfx" 2>/dev/null | grep -v "node_modules" | grep -v ".git" || true)
if [ -n "$key_files" ]; then
    echo -e "${RED}✗ Arquivos de chave encontrados:${NC}"
    echo "$key_files" | while read -r file; do
        echo "  - $file"
    done
    echo ""
    echo -e "${YELLOW}Recomendação: Remova estes arquivos e adicione ao .gitignore${NC}"
    found=$((found + 1))
else
    echo -e "${GREEN}✓ Nenhum arquivo de chave encontrado${NC}"
fi
echo ""

# Resumo
echo "=== Resumo ==="
if [ $found -eq 0 ]; then
    echo -e "${GREEN}✓ Nenhum segredo óbvio encontrado${NC}"
    exit 0
else
    echo -e "${RED}✗ $found possíveis problemas encontrados${NC}"
    echo ""
    echo "Recomendações:"
    echo "1. Revise os arquivos listados acima"
    echo "2. Remova dados sensíveis antes de commit"
    echo "3. Adicione arquivos sensíveis ao .gitignore"
    echo "4. Use variáveis de ambiente para tokens"
    exit 1
fi
