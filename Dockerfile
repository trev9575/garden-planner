# Garden Planner — single container, no npm dependencies.
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

WORKDIR /app
COPY package.json server.js ./
COPY src ./src
COPY public ./public

# Unraid convention: run as nobody:users (99:100) so appdata files are easy to manage.
RUN mkdir -p /data && chown -R 99:100 /data
USER 99:100

VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/healthz || exit 1

CMD ["node", "--no-warnings", "server.js"]
