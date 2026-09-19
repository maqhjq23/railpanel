# RailPanel — Ubuntu 24.04 (akses root penuh) + Node 22 + toolset dev lengkap
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_BREAK_SYSTEM_PACKAGES=1 \
    TERM=xterm-256color

# Node 22 dari NodeSource, lalu toolset lengkap (container jalan sebagai ROOT,
# jadi apt/pip/compile bebas — sesuai kebutuhan user)
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
  && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y --no-install-recommends \
    nodejs \
    git wget zip unzip tar less jq nano vim htop procps psmisc sudo \
    openssh-client iproute2 iputils-ping dnsutils \
    python3 python3-pip python3-venv build-essential \
    tini \
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
