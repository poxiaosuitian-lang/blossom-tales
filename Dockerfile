FROM node:24-bookworm-slim

ENV NODE_ENV=production HOST=0.0.0.0 PORT=5173 DESTINY_DATA_DIR=/app/data
WORKDIR /app

# The server uses Node's built-in modules only; no dependency install is needed.
COPY --chown=node:node package.json server.cjs ./
COPY --chown=node:node dist/ ./dist/
COPY --chown=node:node scripts/healthcheck.cjs ./scripts/healthcheck.cjs
RUN mkdir -p /app/data && chown node:node /app/data

USER node
EXPOSE 5173
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "scripts/healthcheck.cjs"]
CMD ["node", "--no-warnings", "server.cjs"]
