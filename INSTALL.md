# Slack Bridge Installation Guide

## 1. Create Slack App

Go to: https://api.slack.com/apps

Click **"Create New App"** → **"From scratch"**
- App Name: `Claude Code` (or whatever you prefer)
- Workspace: Select your workspace
- Click **Create App**

---

## 2. Enable Socket Mode

In the left sidebar: **Settings → Socket Mode**

1. Toggle **Enable Socket Mode** to ON
2. It will prompt you to create an App-Level Token
3. Token Name: `socket-mode` (or anything)
4. Add scope: `connections:write`
5. Click **Generate**
6. **Copy this token** (starts with `xapp-1-...`) → This is your `SLACK_APP_TOKEN`

---

## 3. Add Bot Token Scopes

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

---

## 4. Subscribe to Events

In the left sidebar: **Features → Event Subscriptions**

1. Toggle **Enable Events** to ON
2. Scroll to **Subscribe to bot events** and add:
   - `message.im` (DMs)
   - `message.channels` (public channels)
   - `message.groups` (private channels)
   - `app_mention` (@mentions)

3. Click **Save Changes**

---

## 5. Install App to Workspace

In the left sidebar: **Settings → Install App**

1. Click **Install to Workspace**
2. Review permissions and click **Allow**
3. **Copy the Bot User OAuth Token** (starts with `xoxb-...`) → This is your `SLACK_BOT_TOKEN`

---

## 6. Add Tokens to Your Environment

```bash
# Add to ~/.claude/.env
echo 'SLACK_BOT_TOKEN=xoxb-your-token-here' >> ~/.claude/.env
echo 'SLACK_APP_TOKEN=xapp-your-token-here' >> ~/.claude/.env
```

Or edit `~/.claude/.env` directly and add:
```
SLACK_BOT_TOKEN=xoxb-your-token-here
SLACK_APP_TOKEN=xapp-your-token-here
```

---

## 7. Start the Bridge

```bash
cd ~/.claude/bridge
bun run start
```

You should see:
```
Starting Claude-Slack Bridge...
  PAI_DIR: /home/jjn/.claude
  Default CWD: /home/jjn/.claude
  Allowed channels: all
Claude-Slack Bridge is running on port 3847
Bot user ID: U0XXXXXXX
```

---

## 8. Test It

1. **DM the bot** - Find your app in Slack's Apps section and send it a message
2. **@mention in a channel** - Invite the bot to a channel, then `@Claude Code hello`
3. **Reply in thread** - Continue the conversation in the thread

---

## Troubleshooting

### "Missing required environment variable"
Make sure both `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` are set in `~/.claude/.env`

### Bot doesn't respond
- Check if bot is invited to the channel (`/invite @Claude Code`)
- Check console logs for errors
- Verify event subscriptions are enabled in Slack app settings

### "not_in_channel" error
The bot needs to be invited to channels before it can read messages. Either:
- Invite it manually: `/invite @Claude Code`
- Or DM the bot directly (always works)

### Rate limiting
The bridge debounces Slack updates to every 500ms. If you still hit rate limits with very long responses, you can increase the interval in the code.

---

## Running as a Service (Optional)

To run the bridge persistently:

```bash
# Using systemd (create ~/.config/systemd/user/claude-bridge.service)
[Unit]
Description=Claude Code Slack Bridge
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/jjn/.claude/bridge
ExecStart=/home/jjn/.bun/bin/bun run start
Restart=on-failure
EnvironmentFile=/home/jjn/.claude/.env

[Install]
WantedBy=default.target
```

Then:
```bash
systemctl --user daemon-reload
systemctl --user enable claude-bridge
systemctl --user start claude-bridge
```

---

## Configuration Options

Set these in `~/.claude/.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `SLACK_BOT_TOKEN` | (required) | Bot OAuth token (xoxb-...) |
| `SLACK_APP_TOKEN` | (required) | App-level token for Socket Mode (xapp-...) |
| `BRIDGE_PORT` | `3847` | Port for the bridge server |
| `BRIDGE_DEFAULT_CWD` | `$PAI_DIR` | Default working directory for Claude sessions |
| `BRIDGE_ALLOWED_CHANNELS` | (all) | Comma-separated channel IDs to restrict access |
| `BRIDGE_ALLOWED_USERS` | (all) | Comma-separated Slack user IDs to restrict access |

---

## Restricting Access by User

To limit who can use the bot, add allowed Slack user IDs:

```bash
BRIDGE_ALLOWED_USERS=U0ABC123,U0DEF456
```

**To find your Slack member ID:**
1. In Slack, click your profile picture (bottom left)
2. Click **Profile**
3. Click the **...** (more actions) button
4. Click **Copy member ID**

Non-allowed users will be silently ignored (no response or error message).

---

## Customizing the Bot Name and Appearance

In your Slack app settings (https://api.slack.com/apps):

### Change Display Name
1. Left sidebar: **Features → App Home**
2. Under **Your App's Presence in Slack**, click **Edit** next to the bot name
3. Set **Display Name (Bot Name)** - this is what shows in conversations
4. Set **Default Username** - this is the @mention name

### Change Icon
1. Left sidebar: **Settings → Basic Information**
2. Scroll to **Display Information**
3. Click **Add App Icon** to upload an image (recommended: 512x512 PNG)
4. You can also set a background color

### Change App Name
1. Left sidebar: **Settings → Basic Information**
2. Under **App Name**, click to edit
3. Note: This changes the name in the Apps directory, not necessarily the display name in chats
