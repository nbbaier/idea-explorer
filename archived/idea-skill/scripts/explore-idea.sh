#!/bin/bash
# explore-idea.sh - Explore business ideas using Claude Code
#
# Usage: explore-idea.sh "Your business idea"
# With notifications: CLAWD_CHAT_NAME="Name" CLAWD_CHAT_ID="123" explore-idea.sh "Idea"

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ $# -eq 0 ]; then
	echo "Usage: explore-idea.sh 'Your business idea'"
	echo "Example: explore-idea.sh 'AI-powered calendar assistant'"
	exit 1
fi

# Generate URL-friendly slug from text
slugify() {
	echo "$1" | tr '[:upper:]' '[:lower:]' | sed -e 's/[^a-z0-9]/-/g' -e 's/--*/-/g' -e 's/^-//' -e 's/-$//' | cut -c1-50
}

# Substitute variables in template file
render_template() {
	local template_file=$1
	local output_file=$2
	sed -e "s|{{IDEA}}|$IDEA|g" \
		-e "s|{{IDEAS_DIR}}|$IDEAS_DIR|g" \
		-e "s|{{NOTIFY_CMD}}|$NOTIFY_CMD|g" \
		"$template_file" >"$output_file"
}

IDEA="$1"
TIMESTAMP=$(date +%s)
SLUG=$(slugify "$IDEA")

# Create output directory
IDEAS_DIR="$HOME/clawd/ideas/$SLUG"
mkdir -p "$IDEAS_DIR"

# Chat context for notifications
CHAT_NAME="${CLAWD_CHAT_NAME:-}"
CHAT_ID="${CLAWD_CHAT_ID:-}"
SESSION_KEY="${CLAWD_SESSION_KEY:-main}"

# Save metadata
cat >"$IDEAS_DIR/metadata.txt" <<EOF
Idea: $IDEA
Date: $(date)
Slug: $SLUG
Chat: $CHAT_NAME
Chat ID: $CHAT_ID
Session: $SESSION_KEY
Status: In Progress
EOF

# Notification command - sends file to "me" and queues notification
NOTIFY_CMD="$HOME/clawd/scripts/notify-research-complete.sh '$IDEAS_DIR/research.md' 'Idea: $IDEA' '$SESSION_KEY'"

# Write prompt from template
PROMPT_FILE="$IDEAS_DIR/prompt.txt"
render_template "$SCRIPT_DIR/prompt-template.md" "$PROMPT_FILE"

# Copy runner script
RUNNER_SCRIPT="$IDEAS_DIR/run-claude.sh"
cp "$SCRIPT_DIR/claude-runner.sh" "$RUNNER_SCRIPT"
chmod +x "$RUNNER_SCRIPT"

# Start tmux session
TMUX_SESSION="idea-${SLUG:0:20}-$TIMESTAMP"

echo "💡 Idea Exploration Starting"
echo "============================"
echo "📋 Idea: $IDEA"
echo "📁 Output: $IDEAS_DIR/research.md"
echo "📺 Session: $TMUX_SESSION"
echo ""

tmux new-session -d -s "$TMUX_SESSION" "$RUNNER_SCRIPT '$PROMPT_FILE'"

echo "✅ Idea exploration started!"
echo ""
echo "Monitor progress:"
echo "  tmux attach -t $TMUX_SESSION"
echo ""
echo "You'll receive a notification when complete."
