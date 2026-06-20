"""Shared Anthropic Claude model ID — override via ANTHROPIC_MODEL in .env."""

import os

# claude-sonnet-4-20250514 was retired; use current Sonnet (see platform.claude.com/docs)
CLAUDE_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6").strip() or "claude-sonnet-4-6"
