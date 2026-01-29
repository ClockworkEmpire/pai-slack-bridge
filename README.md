# PAI Slack Bridge

Bidirectional Slack integration for [PAI](https://github.com/danielmiessler/Personal_AI_Infrastructure). Chat with PAI sessions through Slack threads with full skill and hook support.

## What Is This?

PAI Slack Bridge connects Slack to Claude Code, allowing you to interact with Claude through Slack messages instead of (or in addition to) the command line. Each Slack thread becomes a persistent Claude Code session that you can resume at any time.

**Works with [Personal AI Infrastructure (PAI)](https://github.com/danielmiessler/Personal_AI_Infrastructure)** for the full experience—skills, hooks, custom contexts, and response formats all carry over. Also works with vanilla Claude Code, but some features (like structured responses and custom skills) won't be available.

## Why Use This?

- **Mobile access** - Chat with Claude from your phone via Slack
- **Async workflows** - Start a task, close your laptop, check results later in Slack
- **Team visibility** - Share Claude conversations in channels (with access controls)
- **Session persistence** - Thread replies automatically resume the previous session
- **Full PAI stack** - All your skills, hooks, and context carry over from CLI

## How It Works

```
┌─────────────┐         ┌─────────────────┐         ┌─────────────┐
│   Slack     │◄───────►│  PAI Slack      │◄───────►│ Claude Code │
│   Thread    │ Socket  │  Bridge         │  spawn  │    CLI      │
│             │  Mode   │  (Bun server)   │         │             │
└─────────────┘         └─────────────────┘         └─────────────┘
                               │
                               ▼
                        ┌─────────────┐
                        │ PAI Stack   │
                        │ (skills,    │
                        │  hooks,     │
                        │  settings)  │
                        └─────────────┘
```

1. You send a message in Slack (DM or @mention)
2. Bridge receives it via Slack Socket Mode (no public URL needed)
3. Bridge spawns `claude -p` with your message and streams the response
4. Response streams back to Slack in real-time
5. Thread replies resume the same Claude session via `--resume`

## Features

- **Streaming responses** - See Claude's response as it's generated
- **Session resumption** - Reply in a thread to continue the conversation
- **Tool activity messages** - Friendly per-tool status messages in the thread (e.g., "Reading `config.ts`", "Searching the web for...")
- **Tool indicators** - Emoji reactions show when Claude uses tools (💻 Bash, 👀 Read, etc.)
- **File attachments** - Attach screenshots, PDFs, or code files and Claude can see them natively
- **File delivery** - Claude can send generated files (charts, reports, code) back to the thread
- **Interactive buttons** - Claude's questions render as clickable Slack buttons with multi-question submit flows
- **Desk routing** - Route messages to specialized Claude personas via @mentions (e.g., `@backend`, `@frontend`)
- **Bridge API** - HTTP API on port 3848 for Claude to send files and Block Kit messages to Slack
- **Long message handling** - Automatically splits responses that exceed Slack's limits
- **Access control** - Restrict by Slack user ID or channel
- **Full PAI integration** - Uses your `~/.claude/settings.json`, hooks, and skills

---

## Quick Start

```bash
# Clone and install
git clone https://github.com/yourusername/pai-slack-bridge.git
cd pai-slack-bridge
bun install

# Configure (tokens go in ~/.claude/.env)
# See "Slack App Setup" below for how to get tokens

# Run
bun run start
```

---

## Slack App Setup

### 1. Create Slack App

Go to: https://api.slack.com/apps

Click **"Create New App"** → **"From scratch"**
- App Name: `Claude Code` (or whatever you prefer)
- Workspace: Select your workspace
- Click **Create App**

### 2. Enable Socket Mode

In the left sidebar: **Settings → Socket Mode**

1. Toggle **Enable Socket Mode** to ON
2. It will prompt you to create an App-Level Token
3. Token Name: `socket-mode` (or anything)
4. Add scope: `connections:write`
5. Click **Generate**
6. **Copy this token** (starts with `xapp-1-...`) → This is your `SLACK_APP_TOKEN`

### 3. Add Bot Token Scopes

In the left sidebar: **Features → OAuth & Permissions**

Scroll to **Scopes → Bot Token Scopes** and add:

| Scope | Purpose |
|-------|---------|
| `app_mentions:read` | React to @mentions |
| `channels:history` | Read channel messages |
| `channels:join` | Join public channels |
| `chat:write` | Post messages |
| `files:read` | Download user-attached files (images, PDFs, etc.) |
| `files:write` | Upload files from Claude back to threads |
| `groups:history` | Read private channels |
| `im:history` | Read DMs |
| `im:write` | Send DMs |
| `reactions:write` | Add emoji reactions |

### 4. Enable Messages Tab

In the left sidebar: **Features → App Home**

1. Scroll to **Show Tabs**
2. Check **Messages Tab**
3. Check **Allow users to send Slash commands and messages from the messages tab**

### 5. Subscribe to Events

In the left sidebar: **Features → Event Subscriptions**

1. Toggle **Enable Events** to ON
2. Scroll to **Subscribe to bot events** and add:
   - `message.im` (DMs)
   - `message.channels` (public channels)
   - `message.groups` (private channels)
   - `app_mention` (@mentions)
3. Click **Save Changes**

### 6. Enable Interactivity

In the left sidebar: **Features → Interactivity & Shortcuts**

1. Toggle **Interactivity** to ON
2. You do **not** need a Request URL (Socket Mode handles it)
3. Click **Save Changes**

This enables interactive buttons (used for Claude's AskUserQuestion tool and Bridge API button messages).

### 7. Install App to Workspace

In the left sidebar: **Settings → Install App**

1. Click **Install to Workspace**
2. Review permissions and click **Allow**
3. **Copy the Bot User OAuth Token** (starts with `xoxb-...`) → This is your `SLACK_BOT_TOKEN`

### 8. Add Tokens to Environment

Add to `~/.claude/.env`:

```bash
SLACK_BOT_TOKEN=xoxb-your-token-here
SLACK_APP_TOKEN=xapp-your-token-here
```

### 9. Test It

```bash
cd pai-slack-bridge
bun run start
```

Then:
1. **DM the bot** - Find your app in Slack's Apps section
2. **@mention in a channel** - `@YourBot hello`
3. **Reply in thread** - Continue the conversation

---

## Configuration

The bridge loads its configuration from `$PAI_DIR/.env` (defaults to `~/.claude/.env`).

**Important:** If your PAI installation is not at `~/.claude`, set `PAI_DIR` in your shell environment before running:

```bash
export PAI_DIR=/path/to/your/pai
```

### Environment Variables

Set these in `$PAI_DIR/.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `SLACK_BOT_TOKEN` | (required) | Bot OAuth token (xoxb-...) |
| `SLACK_APP_TOKEN` | (required) | App-level token for Socket Mode (xapp-...) |
| `BRIDGE_PORT` | `3847` | Port for the bridge server |
| `BRIDGE_API_PORT` | `3848` | Port for the Bridge API (file/message sending) |
| `BRIDGE_API_SECRET` | (none) | Optional Bearer token for Bridge API auth |
| `BRIDGE_DEFAULT_CWD` | `$PAI_DIR` | Working directory for Claude sessions |
| `BRIDGE_ALLOWED_CHANNELS` | (all) | Comma-separated channel IDs |
| `BRIDGE_ALLOWED_USERS` | (all) | Comma-separated Slack user IDs |

Set this in your shell environment (or systemd service):

| Variable | Default | Description |
|----------|---------|-------------|
| `PAI_DIR` | `~/.claude` | PAI installation directory (where .env lives) |

### Restricting Access

To limit who can use the bot:

```bash
BRIDGE_ALLOWED_USERS=U0ABC123,U0DEF456
```

**To find your Slack member ID:**
1. Click your profile picture in Slack
2. Click **Profile**
3. Click **...** (more actions)
4. Click **Copy member ID**

Non-allowed users are silently ignored.

---

## Running as a Service

### Linux (systemd)

An install script is provided:

```bash
./install-linux.sh
```

This will:
1. Install the service to `~/.config/systemd/user/`
2. Enable it to start on boot
3. Start it immediately
4. Enable lingering (runs without login)

**Service commands:**

```bash
systemctl --user status pai-slack-bridge    # Check status
journalctl --user -u pai-slack-bridge -f    # Follow logs
systemctl --user restart pai-slack-bridge   # Restart
systemctl --user stop pai-slack-bridge      # Stop
systemctl --user disable pai-slack-bridge   # Disable autostart
```

**Manual installation:**

```bash
mkdir -p ~/.config/systemd/user
cp pai-slack-bridge.service ~/.config/systemd/user/

# Edit the service file if PAI_DIR is not ~/.claude
# nano ~/.config/systemd/user/pai-slack-bridge.service

systemctl --user daemon-reload
systemctl --user enable pai-slack-bridge
systemctl --user start pai-slack-bridge
sudo loginctl enable-linger $USER
```

**Note:** The service file sets `PAI_DIR`. Edit it if your PAI installation is not at `~/.claude`.

### macOS

macOS service support (launchd) is not currently implemented. Contributions welcome!

For now, you can run manually or use a process manager like `pm2`:

```bash
npm install -g pm2
pm2 start "bun run start" --name pai-slack-bridge
pm2 save
pm2 startup  # Follow instructions to enable on boot
```

---

## Customizing the Bot

In your Slack app settings (https://api.slack.com/apps):

### Change Display Name
1. **Features → App Home**
2. Under **Your App's Presence in Slack**, click **Edit**
3. Set **Display Name** and **Default Username**

### Change Icon
1. **Settings → Basic Information**
2. Scroll to **Display Information**
3. Upload an icon (recommended: 512x512 PNG)

---

## Troubleshooting

### "Missing required environment variable"
Ensure both `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` are in `~/.claude/.env`

### Bot doesn't respond
- Check if bot is invited to the channel: `/invite @YourBot`
- Check console/journal logs for errors
- Verify event subscriptions are enabled

### "messages to this app are off"
Enable the Messages Tab in **Features → App Home**

### Rate limiting
The bridge debounces updates to 500ms. Long responses are automatically split into multiple messages.

### File attachments not working
- Ensure `files:read` scope is added to the Slack app
- Reinstall the app after adding new scopes
- Check logs for "HTML content detected" — this means the download URL returned a web page instead of the file

### Buttons not appearing
- Ensure **Interactivity** is enabled in the Slack app settings (Features → Interactivity & Shortcuts)
- Socket Mode handles the interactivity — no Request URL is needed

### Bridge API errors
- Check that port 3848 is not in use: `lsof -i:3848`
- If using `BRIDGE_API_SECRET`, ensure the auth header matches

### No PAI context/skills
Ensure `PAI_DIR` points to your PAI installation (default: `~/.claude`)

---

## Team Mode (Guardrails & Asset Delivery)

For exposing Claude to team members with controlled access, the bridge supports **Team Mode**—a guardrailed experience with task classification, rate limiting, and automatic asset uploads.

### Enabling Team Mode

Create or edit `~/.claude/bridge/data/channels.json`:

```json
{
  "channels": {
    "C0MARKETING": {
      "channelId": "C0MARKETING",
      "channelName": "marketing-ai",
      "enabled": true,
      "capabilities": [
        { "name": "copy", "enabled": true },
        { "name": "briefs", "enabled": true },
        { "name": "visuals", "enabled": true },
        { "name": "research", "enabled": true }
      ],
      "systemPromptPrefix": "You are helping the marketing team. Focus on content creation tasks.",
      "blockedPatterns": ["rm -rf", "sudo", "DELETE FROM"],
      "rateLimits": {
        "requestsPerHour": 20,
        "requestsPerDay": 100,
        "tokensPerDay": 500000
      },
      "maxCostPerDay": 25.00,
      "autoUploadAssets": true,
      "allowedFileTypes": ["png", "pdf", "md"],
      "maxFileSizeMb": 25
    }
  },
  "defaultConfig": {
    "enabled": false
  }
}
```

### Features

**Task Classification**: Incoming requests are automatically classified into categories:
- `copy` - Headlines, blog posts, email drafts, ad copy
- `briefs` - Content briefs, outlines, strategies
- `visuals` - Infographics, diagrams, images
- `research` - KB searches, analysis, summaries

**Guardrails**:
- `capabilities` - Enable/disable task categories per channel
- `blockedPatterns` - Reject requests containing dangerous patterns
- `systemPromptPrefix` - Inject channel-specific instructions
- `rateLimits` - Per-hour/day request limits
- `maxCostPerDay` - Cost ceiling per channel

**Asset Upload**: When `autoUploadAssets: true`:
- Files generated in `~/Downloads/` or `~/.claude/kb/` are detected
- Allowed file types are automatically uploaded to the Slack thread
- Enables seamless infographic and document delivery

**Usage Tracking**: All requests are logged to `~/.claude/bridge/data/usage.json`:
- Per-user and per-channel statistics
- Cost tracking
- Rate limit enforcement

### File Upload Scope

To enable file uploads, add `files:write` to your Slack app's Bot Token Scopes:

1. Go to https://api.slack.com/apps → Your App
2. **Features → OAuth & Permissions**
3. Add `files:write` to Bot Token Scopes
4. **Reinstall the app** to apply the new scope

---

## File Attachments (Slack → Claude)

Attach files to your Slack messages and Claude can see them natively. The bridge downloads the file, saves it locally, and passes the path to Claude's `Read` tool.

**Supported formats:**
- Images: PNG, JPG, GIF, WebP (Claude vision)
- Documents: PDF, TXT, MD, CSV, JSON
- Code: TypeScript, JavaScript

**How it works:**
1. Attach a file to your Slack message (or paste a screenshot)
2. The bridge downloads it via Slack's `url_private` with Bearer auth
3. The file path is prepended to the message: `[Attached: /tmp/slack-bridge-files/.../screenshot.png]`
4. Claude's Read tool natively opens images and PDFs

**Limits:** Files over 10MB are skipped with a warning. Unsupported file types are ignored.

**Required scope:** `files:read` (see Slack App Setup step 3).

---

## Bridge API (Claude → Slack)

An HTTP API server runs alongside the bridge on port 3848. Claude can call it via `curl` to send files and interactive messages back to the Slack thread.

### Endpoints

**`POST /send-file`** — Upload a file to the current thread

```bash
curl -s -X POST http://localhost:3848/send-file \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"SESSION_ID","filePath":"/path/to/file","comment":"optional"}'
```

**`POST /send-message`** — Post a message with optional Block Kit blocks

```bash
curl -s -X POST http://localhost:3848/send-message \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"SESSION_ID","text":"Hello","blocks":[...]}'
```

**`GET /health`** — Health check

Claude is automatically taught these endpoints via the system prompt and uses them to deliver files and present interactive choices.

### CLI Wrapper

A helper script is provided at `bin/slack-bridge-send`:

```bash
# Send a file
slack-bridge-send file <session-id> /path/to/file "optional comment"

# Send a message
slack-bridge-send message <session-id> "Hello from Claude"
```

---

## Interactive Buttons

When Claude uses the `AskUserQuestion` tool, the bridge renders questions as clickable Slack buttons instead of plain text.

**Single question:** Clicking a button immediately sends the selection to Claude.

**Multiple questions:** Each question shows its own button group. Selections are highlighted with a checkmark prefix (e.g., `✅ Option A`). You can change your selection at any time. A "Submit Answers" button at the bottom sends all selections to Claude at once.

Claude can also send custom button layouts via the Bridge API's `/send-message` endpoint with Block Kit `blocks`.

---

## Desk Routing

Route messages to specialized Claude personas using @mentions. Each desk has its own system prompt, boundaries, and knowledge files.

### Setup

Create YAML desk definitions in `~/.claude/bridge/desks/`:

```yaml
# ~/.claude/bridge/desks/backend.yaml
slug: backend
name: Backend Engineer
description: Backend API and database specialist
mentions:
  - "@backend"
  - "@api"
  - "@database"
boundaries:
  writable:
    - "src/api/"
    - "src/models/"
  blocked:
    - "src/frontend/"
knowledge:
  always_load:
    - "docs/api-spec.md"
system_prompt_suffix: "Focus on API design, database queries, and server-side logic."
```

### Usage

In Slack, mention the desk name in your message:

```
@backend Add a new endpoint for user preferences
@frontend Update the settings page layout
@theme Change the primary color to dark teal
```

The bridge automatically loads the desk's context, boundaries, and knowledge into the Claude session.

---

## Architecture

```
pai-slack-bridge/
├── src/
│   ├── index.ts              # Entry point, Socket Mode, button handler
│   ├── handlers/
│   │   └── message.ts        # Message handling, tool activity, buttons
│   ├── middleware/
│   │   └── classifier.ts     # Task classification (Team Mode)
│   ├── services/
│   │   ├── claude.ts         # Claude CLI spawner with streaming
│   │   ├── session.ts        # Thread ↔ Session mapping
│   │   ├── slack.ts          # Slack API wrapper
│   │   ├── slack-files.ts    # Inbound file attachment downloads
│   │   ├── bridge-api.ts     # HTTP API for Claude → Slack (files, messages)
│   │   ├── desk-loader.ts    # Desk definition loader (YAML)
│   │   ├── desk-router.ts    # @mention → desk routing
│   │   ├── session-manifest.ts # Per-session desk context
│   │   ├── channel-config.ts # Team Mode channel configuration
│   │   ├── usage-tracker.ts  # Rate limiting and cost tracking
│   │   ├── prompt-builder.ts # Guardrailed prompt construction
│   │   ├── file-watcher.ts   # Asset detection
│   │   └── file-uploader.ts  # Slack file uploads
│   ├── types/
│   │   ├── index.ts          # Type re-exports
│   │   ├── config.ts         # Channel config types
│   │   ├── usage.ts          # Usage tracking types
│   │   ├── files.ts          # File handling types
│   │   ├── slack.ts          # Slack file, button, block types
│   │   └── desk.ts           # Desk definition types
│   └── lib/
│       └── markdown-to-slack.ts  # Markdown conversion
├── bin/
│   └── slack-bridge-send     # CLI wrapper for Bridge API
├── data/
│   ├── sessions.json         # Session state (auto-created)
│   ├── channels.json         # Team Mode configuration
│   └── usage.json            # Usage tracking data
├── pai-slack-bridge.service  # systemd unit file
├── install-linux.sh          # Linux service installer
└── .env.example              # Configuration template
```

---

## Requirements

- [Bun](https://bun.sh) runtime
- [Claude Code](https://claude.ai/code) CLI installed and authenticated
- Slack workspace with permission to create apps

---

## License

MIT
