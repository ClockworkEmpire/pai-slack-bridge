#!/bin/bash
# Install PAI Slack Bridge as a systemd user service

set -e

SERVICE_NAME="pai-slack-bridge"
SERVICE_FILE="$HOME/github/pai-slack-bridge/pai-slack-bridge.service"
USER_SERVICE_DIR="$HOME/.config/systemd/user"

echo "Installing PAI Slack Bridge service..."

# Create user systemd directory if it doesn't exist
mkdir -p "$USER_SERVICE_DIR"

# Copy service file
cp "$SERVICE_FILE" "$USER_SERVICE_DIR/"

# Reload systemd user daemon
systemctl --user daemon-reload

# Enable service to start on boot
systemctl --user enable "$SERVICE_NAME"

# Start the service now
systemctl --user start "$SERVICE_NAME"

# Enable lingering so user services run without login
sudo loginctl enable-linger "$USER"

echo ""
echo "Service installed and started!"
echo ""
echo "Useful commands:"
echo "  systemctl --user status $SERVICE_NAME   # Check status"
echo "  systemctl --user logs $SERVICE_NAME     # View logs (recent)"
echo "  journalctl --user -u $SERVICE_NAME -f   # Follow logs"
echo "  systemctl --user restart $SERVICE_NAME  # Restart"
echo "  systemctl --user stop $SERVICE_NAME     # Stop"
echo "  systemctl --user disable $SERVICE_NAME  # Disable autostart"
