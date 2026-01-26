#!/bin/bash

# Soonsak Backend API Test Script
# Usage: ./scripts/test-api.sh [command] [args]

BASE_URL="${BASE_URL:-http://localhost:3001}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_result() {
  if [ $1 -eq 0 ]; then
    echo -e "${GREEN}✓ Success${NC}"
  else
    echo -e "${RED}✗ Failed${NC}"
  fi
}

case "$1" in
  status)
    echo -e "${YELLOW}Testing: GET /batch/status${NC}"
    curl -s "$BASE_URL/batch/status" | jq .
    print_result $?
    ;;

  video)
    if [ -z "$2" ]; then
      echo "Usage: $0 video <VIDEO_ID>"
      echo "Example: $0 video dQw4w9WgXcQ"
      exit 1
    fi
    echo -e "${YELLOW}Testing: POST /videos/$2/register${NC}"
    curl -s -X POST "$BASE_URL/videos/$2/register" | jq .
    print_result $?
    ;;

  channel)
    if [ -z "$2" ]; then
      echo "Usage: $0 channel <CHANNEL_ID>"
      exit 1
    fi
    echo -e "${YELLOW}Testing: POST /channels/$2/register${NC}"
    curl -s -X POST "$BASE_URL/channels/$2/register" | jq .
    print_result $?
    ;;

  batch)
    echo -e "${YELLOW}Testing: POST /batch/run${NC}"
    curl -s -X POST "$BASE_URL/batch/run" | jq .
    print_result $?
    ;;

  health)
    echo -e "${YELLOW}Checking server health...${NC}"
    if curl -s --head "$BASE_URL/batch/status" | head -n 1 | grep -q "200"; then
      echo -e "${GREEN}Server is running${NC}"
    else
      echo -e "${RED}Server is not responding${NC}"
      exit 1
    fi
    ;;

  all)
    echo "=== Running All Tests ==="
    echo ""
    $0 health
    echo ""
    $0 status
    ;;

  *)
    echo "Soonsak Backend API Test Script"
    echo ""
    echo "Usage: $0 <command> [args]"
    echo ""
    echo "Commands:"
    echo "  status           - Get batch status"
    echo "  video <ID>       - Process single video"
    echo "  channel <ID>     - Process single channel"
    echo "  batch            - Run full batch processing"
    echo "  health           - Check if server is running"
    echo "  all              - Run health check and status"
    echo ""
    echo "Examples:"
    echo "  $0 status"
    echo "  $0 video dQw4w9WgXcQ"
    echo "  $0 channel UC..."
    ;;
esac
