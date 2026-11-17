# Stream runtime image. Node 24 runs the TypeScript sources directly; one runtime dependency (@anthropic-ai/sdk).
# Build context is the repository root (see deploy/docker-compose.yml).
FROM node:24-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3790 \
    DATA_DIR=/data

WORKDIR /app
# Runtime dependencies only (the Anthropic SDK for the task triage), exactly as locked.
COPY package.json pnpm-lock.yaml tsconfig.json ./
RUN corepack enable && pnpm install --prod --frozen-lockfile && corepack disable
COPY src ./src
COPY web ./web
COPY contracts ./contracts
COPY registry ./registry

EXPOSE 3790
CMD ["node", "--disable-warning=ExperimentalWarning", "src/main.ts"]
