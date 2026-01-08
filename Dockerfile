FROM docker.io/cloudflare/sandbox:0.6.10

# Install Claude Code
RUN npm install -g @anthropic-ai/claude-code

# Bake in analysis prompts
COPY prompts/ /prompts/

# 15 minute timeout
ENV COMMAND_TIMEOUT_MS=900000

EXPOSE 3000
