# Slack Bridge Setup

## 1. Create or Configure Slack App

Go to https://api.slack.com/apps

### If creating new app:
1. Click "Create New App" → "From scratch"
2. Name: "Claude Code" (or similar)
3. Select your workspace

### Required Settings:

#### Socket Mode (Settings → Socket Mode)
1. Enable Socket Mode
2. Generate an App-Level Token with `connections:write` scope
3. Copy this token (starts with `xapp-`) → this is `SLACK_APP_TOKEN`

#### Bot Token Scopes (OAuth & Permissions)
Add these scopes:
- `app_mentions:read` - React to @mentions
- `channels:history` - Read channel messages
- `channels:join` - Join public channels
- `chat:write` - Post messages
- `groups:history` - Read private channel messages
- `im:history` - Read DM history
- `im:write` - Send DMs
- `reactions:write` - Add reactions

Then install/reinstall to workspace and copy the Bot Token (starts with `xoxb-`) → this is `SLACK_BOT_TOKEN`

#### Event Subscriptions (Event Subscriptions → Subscribe to bot events)
Add these events:
- `message.im` - Direct messages
- `message.channels` - Public channel messages
- `message.groups` - Private channel messages
- `app_mention` - @mentions

## 2. Configure Environment

Add to `~/.claude/.env`:

```bash
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
```

## 3. Run the Bridge

```bash
cd ~/.claude/bridge
bun run start
```

Or with auto-reload:
```bash
bun run dev
```

## 4. Test

1. Send a DM to the bot in Slack
2. @mention the bot in a channel it's been invited to
3. Reply in a thread to continue the conversation

## Troubleshooting

### "Missing required environment variable"
Make sure both `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` are set

### Bot doesn't respond
- Check if bot is invited to the channel
- Check console logs for errors
- Verify event subscriptions are enabled

### Rate limiting
The bridge debounces updates (500ms). If you hit rate limits, increase `BRIDGE_UPDATE_INTERVAL_MS`
