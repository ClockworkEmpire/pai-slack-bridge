# PAI Slack Bridge

Bidirectional Slack integration for Claude Code. Chat with Claude Code sessions through Slack threads.

## Features

- **Thread-based conversations** - Each Slack thread maps to a Claude Code session
- **Session resumption** - Reply in a thread to continue the conversation
- **Streaming responses** - See Claude's response as it's generated
- **Tool indicators** - Emoji reactions show when Claude uses tools
- **Access control** - Restrict by user ID or channel

## Quick Start

```bash
# Install dependencies
bun install

# Copy and configure environment
cp .env.example .env
# Edit .env with your Slack tokens

# Run the bridge
bun run start
```

## Slack App Setup

See [INSTALL.md](INSTALL.md) for detailed Slack app configuration instructions.

**Quick summary:**
1. Create a Slack app at https://api.slack.com/apps
2. Enable Socket Mode and get the App Token (`xapp-...`)
3. Add bot scopes and install to get Bot Token (`xoxb-...`)
4. Subscribe to message events
5. Add tokens to `.env`

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `SLACK_BOT_TOKEN` | (required) | Bot OAuth token |
| `SLACK_APP_TOKEN` | (required) | App-level token for Socket Mode |
| `BRIDGE_ALLOWED_USERS` | (all) | Comma-separated user IDs |
| `BRIDGE_ALLOWED_CHANNELS` | (all) | Comma-separated channel IDs |
| `BRIDGE_DEFAULT_CWD` | `$HOME` | Working directory for Claude |
| `BRIDGE_PORT` | `3847` | Server port |
| `BRIDGE_DATA_DIR` | `./data` | Session storage directory |

## Usage

- **DM the bot** - Start a conversation in direct messages
- **@mention** - `@YourBot help me with X` in any channel
- **Reply in thread** - Continue the conversation, session is preserved

## Running as a Service

```bash
# Using systemd
sudo cp pai-slack-bridge.service /etc/systemd/system/
sudo systemctl enable pai-slack-bridge
sudo systemctl start pai-slack-bridge
```

## Requirements

- [Bun](https://bun.sh) runtime
- [Claude Code](https://claude.ai/code) CLI installed and authenticated

## License

MIT
