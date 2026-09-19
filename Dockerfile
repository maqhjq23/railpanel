# RailPanel — Next.js + socket.io dalam 1 port, plus python3/zip/git buat server user
FROM node:22-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    zip unzip git curl nano procps tini ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY . .
RUN npx next build

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.mjs"]
