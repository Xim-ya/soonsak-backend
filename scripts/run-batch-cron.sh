#!/bin/zsh
# launchd가 하루 1회 호출하는 배치 실행 래퍼.
# launchd는 최소 PATH로 실행되므로 node 경로를 명시한다(Homebrew).
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

PROJECT_DIR="/Users/ximya/soonsak/reboot/soonsak-backend"
cd "$PROJECT_DIR" || exit 1

LOG="$PROJECT_DIR/logs/run-batch-$(date +%Y%m%d).log"
mkdir -p "$PROJECT_DIR/logs"

echo "" >> "$LOG"
echo "===== launchd run $(date '+%Y-%m-%d %H:%M:%S %Z') =====" >> "$LOG"

exec npx ts-node -r tsconfig-paths/register scripts/run-batch.ts >> "$LOG" 2>&1
