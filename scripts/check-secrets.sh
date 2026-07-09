#!/bin/bash
#
# check-secrets.sh — detect secrets and sensitive files in the repository
#
# Usage:
#   scripts/check-secrets.sh          # defaults to --ci
#   scripts/check-secrets.sh --ci     # strict mode, fail only on strong findings
#   scripts/check-secrets.sh --audit  # broad scan, warnings only (no exit failure)
#
# --ci mode looks for:
#   - API keys and tokens (OPENAI_API_KEY, ANTHROPIC_API_KEY, GITHUB_TOKEN, etc.)
#   - Real key patterns (sk-..., ghp_..., BEGIN PRIVATE KEY)
#   - .env files, .pem, .key, .p12, .pfx files
#   - Skips docs/, prompts/, SECURITY.md, and text examples to reduce false positives
#
# --audit mode looks for:
#   - Generic sensitive terms (token, secret, password, api_key) everywhere
#   - Shows warnings but does not exit with failure

set -euo pipefail

MODE="${1:---ci}"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
found=0

# Files and dirs always ignored
ignore_expr="\
-not -path './node_modules/*' \
-not -path './.git/*' \
-not -path './dist/*' \
-not -path './.mimo-backups/*' \
-not -name '.gitignore' \
-not -name 'check-secrets.sh'"

# Skip doc/prompt/security files in --ci mode to reduce false positives
if [ "$MODE" = "--ci" ]; then
  ignore_expr="$ignore_expr \
-not -path './docs/*' \
-not -path './prompts/*' \
-not -name 'SECURITY.md' \
-not -name 'README.md' \
-not -name 'CONTRIBUTING.md'"
  echo -e "${GREEN}=== Modo CI — Verificação restrita (sem docs/prompts) ===${NC}"
elif [ "$MODE" = "--audit" ]; then
  echo -e "${YELLOW}=== Modo AUDIT — Verificação ampla (avisos apenas) ===${NC}"
else
  echo -e "${YELLOW}Unknown mode: $MODE, defaulting to --ci${NC}"
  MODE="--ci"
fi
echo ""

# ── Strong patterns (always checked) ──────────────────────────
ci_patterns=(
  "OPENAI_API_KEY\s*="
  "ANTHROPIC_API_KEY\s*="
  "GITHUB_TOKEN\s*="
  "sk-[A-Za-z0-9_-]{20,}"
  "ghp_[A-Za-z0-9_]{20,}"
  "gho_[A-Za-z0-9_]{20,}"
  "ghu_[A-Za-z0-9_]{20,}"
  "ghs_[A-Za-z0-9_]{20,}"
  "ghr_[A-Za-z0-9_]{20,}"
  "BEGIN (RSA|OPENSSH|EC|DSA|PRIVATE) KEY"
)

# ── Broad patterns (audit only) ────────────────────────────────
audit_patterns=(
  "password"
  "token"
  "secret"
  "api_key"
  "apikey"
  "private_key"
)

# ── Pattern checking function ──────────────────────────────────
check_patterns() {
  local desc="$1"
  shift
  local patterns=("$@")
  local count=0

  for pattern in "${patterns[@]}"; do
    local expr="$ignore_expr"
    if [ "$MODE" = "--ci" ]; then
      eval "find . -type f $ignore_expr" 2>/dev/null | while read -r file; do
        if grep -q -i "$pattern" "$file" 2>/dev/null; then
          echo "$file"
        fi
      done | sort -u | while read -r file; do
        echo -e "${RED}⚠ Achado: '$pattern' em $file${NC}"
        grep -n -i "$pattern" "$file" 2>/dev/null | head -2 | while read -r line; do
          echo "    $line"
        done
      done

      hits=$(eval "find . -type f $ignore_expr" 2>/dev/null | xargs grep -l -i "$pattern" 2>/dev/null | wc -l)
      if [ "$hits" -gt 0 ]; then
        count=$((count + hits))
      fi
    fi
  done
  echo "$count"
}

echo "--- Buscando padrões de chaves e tokens reais ---"
for pattern in "${ci_patterns[@]}"; do
  while IFS= read -r file; do
    [ -z "$file" ] && continue
    echo -e "${RED}⚠ '$pattern' em $file${NC}"
    grep -n -i "$pattern" "$file" 2>/dev/null | head -2 | while read -r line; do
      echo "    $line"
    done
    found=$((found + 1))
  done < <(eval "find . -type f $ignore_expr" 2>/dev/null | xargs grep -l -i "$pattern" 2>/dev/null || true)
done

# ── Check .env files ───────────────────────────────────────────
echo ""
echo "--- Verificando arquivos .env ---"
env_files=$(find . -name "*.env" -o -name ".env*" 2>/dev/null | grep -v "node_modules" | grep -v ".git" || true)
if [ -n "$env_files" ]; then
  echo -e "${RED}✗ Arquivos .env encontrados:${NC}"
  echo "$env_files" | while read -r file; do echo "  - $file"; done
  echo -e "${YELLOW}Recomendação: Adicione ao .gitignore e não commit${NC}"
  found=$((found + 1))
else
  echo -e "${GREEN}✓ Nenhum arquivo .env encontrado${NC}"
fi

# ── Check private key files ────────────────────────────────────
echo ""
echo "--- Verificando chaves privadas ---"
key_files=$(find . \( -name "*.pem" -o -name "*.key" -o -name "*.p12" -o -name "*.pfx" \) 2>/dev/null | grep -v "node_modules" | grep -v ".git" || true)
if [ -n "$key_files" ]; then
  echo -e "${RED}✗ Arquivos de chave encontrados:${NC}"
  echo "$key_files" | while read -r file; do echo "  - $file"; done
  echo -e "${YELLOW}Recomendação: Remova e adicione ao .gitignore${NC}"
  found=$((found + 1))
else
  echo -e "${GREEN}✓ Nenhum arquivo de chave encontrado${NC}"
fi

# ── Audit mode: broad patterns (warnings only) ─────────────────
if [ "$MODE" = "--audit" ]; then
  echo ""
  echo -e "${YELLOW}--- Scan amplo de termos genéricos (avisos, sem falha) ---${NC}"
  for pattern in "${audit_patterns[@]}"; do
    while IFS= read -r file; do
      [ -z "$file" ] && continue
      echo -e "${YELLOW}⚠ Termo genérico '$pattern' em $file${NC}"
      grep -n -i "$pattern" "$file" 2>/dev/null | head -2 | while read -r line; do
        echo "    $line"
      done
    done < <(eval "find . -type f $ignore_expr" 2>/dev/null | xargs grep -l -i "$pattern" 2>/dev/null || true)
  done
fi

# ── Summary ─────────────────────────────────────────────────────
echo ""
echo "=== Resumo ==="
if [ "$found" -eq 0 ]; then
  echo -e "${GREEN}✓ Nenhum segredo óbvio encontrado${NC}"
  exit 0
fi

if [ "$MODE" = "--audit" ]; then
  echo -e "${YELLOW}⚠ $found possíveis problemas encontrados (audit mode — aviso apenas)${NC}"
  echo ""
  echo "Recomendações:"
  echo "1. Revise os arquivos listados acima"
  echo "2. Remova dados sensíveis antes de commit"
  echo "3. Adicione arquivos sensíveis ao .gitignore"
  echo "4. Use variáveis de ambiente para tokens"
  exit 0
fi

echo -e "${RED}✗ $found possíveis problemas encontrados${NC}"
echo ""
echo "Recomendações:"
echo "1. Revise os arquivos listados acima"
echo "2. Remova dados sensíveis antes de commit"
echo "3. Adicione arquivos sensíveis ao .gitignore"
echo "4. Use variáveis de ambiente para tokens"
exit 1
