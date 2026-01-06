# PAI Slack Bridge

Bidirectional Slack integration for Claude Code. Chat with Claude Code sessions through Slack threads with full PAI skill and hook support.

## What Is This?

PAI Slack Bridge connects Slack to Claude Code, allowing you to interact with Claude through Slack messages instead of (or in addition to) the command line. Each Slack thread becomes a persistent Claude Code session that you can resume at any time.

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
- **Tool indicators** - Emoji reactions show when Claude uses tools (🔧 Bash, 👀 Read, etc.)
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

### 6. Install App to Workspace

In the left sidebar: **Settings → Install App**

1. Click **Install to Workspace**
2. Review permissions and click **Allow**
3. **Copy the Bot User OAuth Token** (starts with `xoxb-...`) → This is your `SLACK_BOT_TOKEN`

### 7. Add Tokens to Environment

Add to `~/.claude/.env`:

```bash
SLACK_BOT_TOKEN=xoxb-your-token-here
SLACK_APP_TOKEN=xapp-your-token-here
```

### 8. Test It

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

Set these in `~/.claude/.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `SLACK_BOT_TOKEN` | (required) | Bot OAuth token (xoxb-...) |
| `SLACK_APP_TOKEN` | (required) | App-level token for Socket Mode (xapp-...) |
| `BRIDGE_PORT` | `3847` | Port for the bridge server |
| `BRIDGE_DEFAULT_CWD` | `$PAI_DIR` | Working directory for Claude sessions |
| `BRIDGE_ALLOWED_CHANNELS` | (all) | Comma-separated channel IDs |
| `BRIDGE_ALLOWED_USERS` | (all) | Comma-separated Slack user IDs |
| `PAI_DIR` | `~/.claude` | PAI installation directory |

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
systemctl --user daemon-reload
systemctl --user enable pai-slack-bridge
systemctl --user start pai-slack-bridge
sudo loginctl enable-linger $USER
```

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

### No PAI context/skills
Ensure `PAI_DIR` points to your PAI installation (default: `~/.claude`)

---

## Architecture

```
pai-slack-bridge/
├── src/
│   ├── index.ts              # Entry point, Socket Mode server
│   ├── handlers/
│   │   └── message.ts        # Message and @mention handling
│   ├── services/
│   │   ├── claude.ts         # Claude CLI spawner with streaming
│   │   ├── session.ts        # Thread ↔ Session mapping
│   │   └── slack.ts          # Slack API wrapper
│   └── lib/
│       └── markdown-to-slack.ts  # Markdown conversion
├── data/
│   └── sessions.json         # Session state (auto-created)
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
