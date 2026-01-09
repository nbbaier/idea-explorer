#!/bin/bash
# Ralph Wiggum - Long-running AI agent loop
# Usage: ./ralph.sh [max_iterations]

set -e

MAX_ITERATIONS=${1:-10}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PRD_FILE="$REPO_ROOT/tasks/prd.json"
PROGRESS_FILE="$REPO_ROOT/tasks/progress.txt"
ARCHIVE_DIR="$REPO_ROOT/tasks/archive"
LAST_BRANCH_FILE="$SCRIPT_DIR/.last-branch"

# Archive previous run if branch changed
if [ -f "$PRD_FILE" ] && [ -f "$LAST_BRANCH_FILE" ]; then
	CURRENT_BRANCH=$(jq -r '.branchName // empty' "$PRD_FILE" 2>/dev/null || echo "")
	LAST_BRANCH=$(cat "$LAST_BRANCH_FILE" 2>/dev/null || echo "")

	if [ -n "$CURRENT_BRANCH" ] && [ -n "$LAST_BRANCH" ] && [ "$CURRENT_BRANCH" != "$LAST_BRANCH" ]; then
		# Check if already archived
		ALREADY_ARCHIVED=false
		if [ -d "$ARCHIVE_DIR" ]; then
			for f in "$ARCHIVE_DIR"/*/prd.json; do
				if [ -f "$f" ] && [ "$(jq -r '.branchName' "$f" 2>/dev/null)" == "$LAST_BRANCH" ]; then
					ALREADY_ARCHIVED=true
					break
				fi
			done
		fi

		if [ "$ALREADY_ARCHIVED" = "true" ]; then
			echo "Branch changed to $CURRENT_BRANCH, but $LAST_BRANCH is already archived. Skipping archive."
		else
			# Archive the previous run
			DATE=$(date +%Y-%m-%d)
			# Strip "ralph/" prefix from branch name for folder
			FOLDER_NAME=$(echo "$LAST_BRANCH" | sed 's|^ralph/||')
			ARCHIVE_FOLDER="$ARCHIVE_DIR/$DATE-$FOLDER_NAME"

			echo "Archiving previous run: $LAST_BRANCH"
			mkdir -p "$ARCHIVE_FOLDER"
			[ -f "$PRD_FILE" ] && cp "$PRD_FILE" "$ARCHIVE_FOLDER/"
			[ -f "$PROGRESS_FILE" ] && cp "$PROGRESS_FILE" "$ARCHIVE_FOLDER/"
			echo "   Archived to: $ARCHIVE_FOLDER"
		fi

		# Reset progress file for new run, keeping Codebase Patterns if they exist
		if [ -f "$PROGRESS_FILE" ]; then
			PATTERNS=$(sed -n '/## Codebase Patterns/,/---/p' "$PROGRESS_FILE" 2>/dev/null || echo "")
			if [ -n "$PATTERNS" ]; then
				echo "$PATTERNS" >"$PROGRESS_FILE.tmp"
				echo "" >>"$PROGRESS_FILE.tmp"
				echo "# Ralph Progress Log" >>"$PROGRESS_FILE.tmp"
				echo "Started: $(date)" >>"$PROGRESS_FILE.tmp"
				echo "---" >>"$PROGRESS_FILE.tmp"
				mv "$PROGRESS_FILE.tmp" "$PROGRESS_FILE"
			else
				echo "# Ralph Progress Log" >"$PROGRESS_FILE"
				echo "Started: $(date)" >>"$PROGRESS_FILE"
				echo "---" >>"$PROGRESS_FILE"
			fi
		else
			echo "# Ralph Progress Log" >"$PROGRESS_FILE"
			echo "Started: $(date)" >>"$PROGRESS_FILE"
			echo "---" >>"$PROGRESS_FILE"
		fi
	fi
fi

# Track current branch
if [ -f "$PRD_FILE" ]; then
	CURRENT_BRANCH=$(jq -r '.branchName // empty' "$PRD_FILE" 2>/dev/null || echo "")
	if [ -n "$CURRENT_BRANCH" ]; then
		echo "$CURRENT_BRANCH" >"$LAST_BRANCH_FILE"
	fi
fi

# Initialize progress file if it doesn't exist
if [ ! -f "$PROGRESS_FILE" ]; then
	echo "# Ralph Progress Log" >"$PROGRESS_FILE"
	echo "Started: $(date)" >>"$PROGRESS_FILE"
	echo "---" >>"$PROGRESS_FILE"
fi

echo "Starting Ralph - Max iterations: $MAX_ITERATIONS"

for i in $(seq 1 $MAX_ITERATIONS); do
	echo ""
	echo "═══════════════════════════════════════════════════════"
	echo "  Ralph Iteration $i of $MAX_ITERATIONS"
	echo "═══════════════════════════════════════════════════════"

	# Show current status from PRD
	if [ -f "$PRD_FILE" ]; then
		TOTAL=$(jq '.userStories | length' "$PRD_FILE" 2>/dev/null || echo "?")
		DONE=$(jq '[.userStories[] | select(.passes == true)] | length' "$PRD_FILE" 2>/dev/null || echo "?")
		NEXT_STORY=$(jq -r '[.userStories[] | select(.passes == false)] | sort_by(.priority) | .[0] | "\(.id): \(.title)"' "$PRD_FILE" 2>/dev/null || echo "unknown")

		echo ""
		echo "  Progress: $DONE/$TOTAL stories complete"
		echo "  Next up:  $NEXT_STORY"
		echo ""
	fi

	# Run amp with the ralph prompt
	OUTPUT=$(cat "$SCRIPT_DIR/prompt.md" | amp --dangerously-allow-all 2>&1 | tee /dev/stderr) || true

	# Check for completion signal
	if echo "$OUTPUT" | grep -q "<promise>COMPLETE</promise>"; then
		echo ""
		echo "Ralph completed all tasks!"
		echo "Completed at iteration $i of $MAX_ITERATIONS"
		exit 0
	fi

	echo "Iteration $i complete. Continuing..."
	sleep 2
done

echo ""
echo "Ralph reached max iterations ($MAX_ITERATIONS) without completing all tasks."
echo "Check $PROGRESS_FILE for status."
exit 1
