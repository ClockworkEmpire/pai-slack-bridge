# Desk Routing (In Progress)

> **Status:** Experimental. The desk routing system is functional but not yet production-ready. The @mention detection uses plain-text regex matching, which has known limitations with Slack's native mention system.

## Overview

Route messages to specialized Claude personas using @mentions in Slack. Each desk has its own system prompt, boundaries, and knowledge files.

## How It Works

1. User types `@backend fix the API` in Slack
2. The bridge regex-matches `@backend` from the raw message text
3. Looks up the `backend` desk definition from YAML
4. Injects the desk's system prompt, boundaries, and knowledge into the Claude session
5. Strips the @mention from the message before sending to Claude

## Known Limitations

- **Plain-text matching only** — Desk mentions use regex (`@word`), not Slack's native `<@USERID>` mention system. This works because Slack leaves unrecognized `@names` as plain text, but it means:
  - No autocomplete in Slack for desk names
  - If a Slack user happens to be named "backend", their `<@U...>` mention would not trigger the desk
  - No visual indicator in Slack that the mention is "special"
- **No inter-desk communication** — Desks can't talk to each other or delegate to other desks
- **Single desk per message** — Only the first matched desk is used as the primary context
- **No desk-to-agent bridge** — Desks and PAI agents (Task tool subagent_types) are separate systems

## Setup

Desk YAML definitions are loaded from `$PAI_DIR/MEMORY/desks/` (default: `~/.claude/MEMORY/desks/`).

### Desk Definition

```yaml
# ~/.claude/MEMORY/desks/backend.yaml
slug: backend
name: Backend Engineer
description: Backend API and database specialist
routing:
  mentions:
    - "@backend"
    - "@api"
    - "@database"
  channel: null
boundaries:
  writable:
    - "src/api/"
    - "src/models/"
  readable:
    - "src/"
  blocked:
    - "src/frontend/"
knowledge:
  always_load:
    - "docs/api-spec.md"
  on_mention: {}
composition:
  traits:
    - "helpful"
    - "precise"
system_prompt_suffix: "Focus on API design, database queries, and server-side logic."
persistence:
  session_memory: true
```

### Defaults

Create `_defaults.yaml` in the desks directory for shared configuration:

```yaml
# ~/.claude/MEMORY/desks/_defaults.yaml
boundaries:
  blocked:
    - ".env"
    - "credentials/"
knowledge:
  always_load:
    - "docs/coding-standards.md"
system_prompt_suffix: "Follow project coding standards."
```

Defaults are merged into every desk definition. Desk-specific values take precedence.

## Usage

In Slack, include the desk @mention in your message:

```
@backend Add a new endpoint for user preferences
@frontend Update the settings page layout
@theme Change the primary color to dark teal
```

The bridge automatically loads the desk's context, boundaries, and knowledge into the Claude session.

If no @mention is found, the bridge falls back to the default desk (a desk with no mentions defined), or runs without desk context.

## Architecture

| File | Purpose |
|------|---------|
| `src/types/desk.ts` | DeskDefinition, DeskRouteResult types |
| `src/services/desk-loader.ts` | YAML loader, cache, file watcher |
| `src/services/desk-router.ts` | @mention regex matching and routing |
| `src/services/session-manifest.ts` | Per-session desk context files |
| `src/services/claude.ts` | Injects desk context into system prompt |
| `src/handlers/message.ts` | Routes messages, cleans @mentions |

## Future Considerations

- Slack Workflow/shortcut integration for proper desk selection UI
- Inter-desk delegation (backend asks frontend to review)
- Desk-specific conversation history and memory
- Channel-level desk defaults (all messages in #backend-dev go to backend desk)
