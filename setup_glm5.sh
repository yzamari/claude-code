#!/bin/bash

# setup_glm5.sh - Automates GLM-5.1 setup with OpenCode

CREDENTIALS_FILE="/Users/yahavzamari/Projects/GitHub/claude-code/credentials_summary.md"

# 1. Check if credentials file exists
if [[ ! -f "$CREDENTIALS_FILE" ]]; then
    echo "Error: Credentials file '$CREDENTIALS_FILE' not found."
    exit 1
fi

echo "Reading credentials from $CREDENTIALS_FILE..."

# 2. Extract credentials using grep and sed
# Note: Using sed to strip the Markdown formatting and extract only the value
EMAIL=$(grep "Temporary Email" "$CREDENTIALS_FILE" | sed 's/.*: //')
PASSWORD=$(grep "Password" "$CREDENTIALS_FILE" | sed 's/.*: //')

# The API key was noted as [Retrieved by Agent during automation]
# Since it's not in the file, we prompt the user or check environment
API_KEY=$(grep "API Key" "$CREDENTIALS_FILE" | sed 's/.*: //')

if [[ "$API_KEY" == "[Retrieved by Agent during automation]" ]] || [[ -z "$API_KEY" ]]; then
    echo "Warning: API Key not found in $CREDENTIALS_FILE."
    read -p "Please enter your Fireworks API Key manually: " API_KEY
fi

if [[ -z "$API_KEY" ]]; then
    echo "Error: API Key is required."
    exit 1
fi

# 3. Set Environment Variables
export OPENCODE_PROVIDER='fireworks'
export OPENCODE_API_KEY="$API_KEY"
# Also export the specific key mentioned in GLM5_GUIDE if needed
export OPENCODE_GLM_API_KEY="$API_KEY"

echo "Environment variables set:"
echo "- OPENCODE_PROVIDER: $OPENCODE_PROVIDER"
echo "- OPENCODE_API_KEY: [PROTECTED]"

# 4. Launch the Session
echo "Launching OpenCode with GLM-5.1..."

# We use 'exec' so that the shell script process is replaced by the opencode process,
# allowing the user to interact with it directly.
exec opencode --model glm-5.1
