# Stream runtime image. No runtime dependencies: Node 24 runs the TypeScript sources directly.
# Build context is the repository root (see deploy/docker-compose.yml).
FROM node:24-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3790 \
    DATA_DIR=/data

WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src
COPY web ./web
COPY contracts ./contracts
COPY registry ./registry

EXPOSE 3790
CMD ["node", "--disable-warning=ExperimentalWarning", "src/main.ts"]
