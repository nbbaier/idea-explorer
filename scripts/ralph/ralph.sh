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

# Get branch name from PRD file
get_current_branch() {
	jq -r '.branchName // empty' "$PRD_FILE" 2>/dev/null || echo ""
}

# Check if a branch is already archived
is_branch_archived() {
	local branch=$1
	[ ! -d "$ARCHIVE_DIR" ] && return 1

	for f in "$ARCHIVE_DIR"/*/prd.json; do
		if [ -f "$f" ] && [ "$(jq -r '.branchName' "$f" 2>/dev/null)" == "$branch" ]; then
			return 0
		fi
	done
	return 1
}

# Initialize or reset progress file
init_progress_file() {
	local preserve_patterns=${1:-true}

	if [ "$preserve_patterns" = "true" ] && [ -f "$PROGRESS_FILE" ]; then
		local patterns=$(sed -n '/## Codebase Patterns/,/---/p' "$PROGRESS_FILE" 2>/dev/null || echo "")
		if [ -n "$patterns" ]; then
			{
				echo "$patterns"
				echo ""
				echo "# Ralph Progress Log"
				echo "Started: $(date)"
				echo "---"
			} >"$PROGRESS_FILE"
			return
		fi
	fi

	{
		echo "# Ralph Progress Log"
		echo "Started: $(date)"
		echo "---"
	} >"$PROGRESS_FILE"
}

# Archive a previous run
archive_run() {
	local branch=$1
	local date=$(date +%Y-%m-%d)
	local folder_name=$(echo "$branch" | sed 's|^ralph/||')
	local archive_folder="$ARCHIVE_DIR/$date-$folder_name"

	echo "Archiving previous run: $branch"
	mkdir -p "$archive_folder"
	[ -f "$PRD_FILE" ] && cp "$PRD_FILE" "$archive_folder/"
	[ -f "$PROGRESS_FILE" ] && cp "$PROGRESS_FILE" "$archive_folder/"
	echo "   Archived to: $archive_folder"
}

# Display current status from PRD
show_status() {
	[ ! -f "$PRD_FILE" ] && return

	local total=$(jq '.userStories | length' "$PRD_FILE" 2>/dev/null || echo "?")
	local done=$(jq '[.userStories[] | select(.passes == true)] | length' "$PRD_FILE" 2>/dev/null || echo "?")
	local next_story=$(jq -r '[.userStories[] | select(.passes == false)] | sort_by(.priority) | .[0] | "\(.id): \(.title)"' "$PRD_FILE" 2>/dev/null || echo "unknown")

	echo ""
	echo "  Progress: $done/$total stories complete"
	echo "  Next up:  $next_story"
	echo ""
}

# Archive previous run if branch changed
if [ -f "$PRD_FILE" ] && [ -f "$LAST_BRANCH_FILE" ]; then
	CURRENT_BRANCH=$(get_current_branch)
	LAST_BRANCH=$(cat "$LAST_BRANCH_FILE" 2>/dev/null || echo "")

	if [ -n "$CURRENT_BRANCH" ] && [ -n "$LAST_BRANCH" ] && [ "$CURRENT_BRANCH" != "$LAST_BRANCH" ]; then
		if is_branch_archived "$LAST_BRANCH"; then
			echo "Branch changed to $CURRENT_BRANCH, but $LAST_BRANCH is already archived. Skipping archive."
		else
			archive_run "$LAST_BRANCH"
		fi
		init_progress_file true
	fi
fi

# Track current branch
if [ -f "$PRD_FILE" ]; then
	CURRENT_BRANCH=$(get_current_branch)
	[ -n "$CURRENT_BRANCH" ] && echo "$CURRENT_BRANCH" >"$LAST_BRANCH_FILE"
fi

# Initialize progress file if it doesn't exist
[ ! -f "$PROGRESS_FILE" ] && init_progress_file false

echo "Starting Ralph - Max iterations: $MAX_ITERATIONS"

for i in $(seq 1 $MAX_ITERATIONS); do
	echo ""
	echo "═══════════════════════════════════════════════════════"
	echo "  Ralph Iteration $i of $MAX_ITERATIONS"
	echo "═══════════════════════════════════════════════════════"

	show_status

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
