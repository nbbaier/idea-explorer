# Idea Explorer Demo UI - Spec

## Goal

A simple web UI that streams the agent's activity in real-time so you can watch it "think" during a demo.

## Core UX

Single page with:

1. **Input** - text field for the research topic + "Go" button
2. **Activity feed** - a scrolling log that shows what the agent is doing as it happens
3. **Final output** - the synthesized result at the end

## Activity Feed Events

Stream these as they happen:

- `thinking` - "Breaking down topic into sub-questions..."
- `search` - "Searching: [query]"
- `search_result` - "Found [n] results for [query]"
- `reading` - "Reading: [source title/url]"
- `synthesizing` - "Synthesizing findings..."
- `done` - "Complete"

Each event = one line in the feed, maybe with a timestamp or elapsed time.

## Visual Style

Keep it minimal:

- Monospace font for the activity feed (feels like watching logs)
- Simple color coding: gray for in-progress, green for complete, red for errors
- Auto-scroll to bottom as new events come in

## Technical Approach

- Agent emits events via SSE (Server-Sent Events) or WebSocket
- UI subscribes and appends to the feed
- Store final result separately to render nicely at the end

## Out of Scope (for now)

- Pause/resume controls
- Editing mid-run
- History of past runs
- Mobile responsiveness
