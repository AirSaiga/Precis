#!/usr/bin/env bash
# 重置所有 challenges 的 workspace/ 到 seed/ 副本。
# 用法：在 challenges/ 目录下执行 ./reset.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

count=0
for challenge in C*/; do
  [ -d "$challenge" ] || continue
  seed="$challenge/seed"
  workspace="$challenge/workspace"
  if [ ! -d "$seed" ]; then
    echo "skip $challenge (no seed/)"
    continue
  fi
  rm -rf "$workspace"
  cp -r "$seed" "$workspace"
  count=$((count + 1))
  echo "reset $challenge"
done

echo "Reset $count challenge(s)"
