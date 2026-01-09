#!/bin/bash
# claude-runner.sh - Runs Claude with unset OAuth to use Claude Max

# Unset OAuth to use Claude Max
unset CLAUDE_CODE_OAUTH_TOKEN
unset CLAUDE_CONFIG_DIR
unset ANTHROPIC_BASE_URL

# Read prompt and run claude
PROMPT=$(cat "$1")
cd ~/clawd
claude --dangerously-skip-permissions --model opus "$PROMPT"
echo ""
echo "Session complete. Press any key to exit."
read
