#!/bin/bash
# Bash script to run LiveKit Agent with logging

echo "🚀 Starting LiveKit Agent with Beyond Presence Integration..."
echo ""

# Check if .env.local exists
if [ ! -f ".env.local" ]; then
    echo "❌ ERROR: .env.local file not found!"
    echo "Please create .env.local and add required environment variables."
    echo ""
    echo "Required variables:"
    echo "  - LIVEKIT_URL"
    echo "  - LIVEKIT_API_KEY"
    echo "  - LIVEKIT_API_SECRET"
    echo "  - OPENAI_API_KEY"
    echo "  - BEYOND_PRESENCE_API_KEY"
    echo "  - BEYOND_PRESENCE_AVATAR_ID"
    exit 1
fi

# Check if uv is installed
if ! command -v uv &> /dev/null; then
    echo "❌ ERROR: uv is not installed!"
    echo "Please install uv: https://github.com/astral-sh/uv"
    exit 1
fi

# Check if dependencies are installed
if [ ! -d ".venv" ]; then
    echo "📦 Installing dependencies..."
    uv sync
    if [ $? -ne 0 ]; then
        echo "❌ Failed to install dependencies!"
        exit 1
    fi
fi

# Download required files (VAD models, etc.)
echo "📥 Downloading required models..."
uv run python src/agent.py download-files
echo ""

# Set environment variables for better logging
export PYTHONUNBUFFERED=1
export LOG_LEVEL=INFO

echo "✅ Starting Agent..."
echo "📍 Logs will appear below:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Run the agent in dev mode with detailed logging
uv run python src/agent.py dev
