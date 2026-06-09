# Node 24 = current LTS line ("Krypton", Active LTS since Oct 2025) and the
# package.json floor (engines: node >=24); pin the deploy runtime to the latest LTS.
FROM node:24-slim
WORKDIR /app

# pnpm only (PNPM_SECURITY.md). Use the version pinned in package.json's
# `packageManager` field via Corepack; disable the interactive download prompt so the
# build is non-interactive.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

# Lockfile-driven, reproducible install. pnpm-workspace.yaml carries the supply-chain
# controls (allowBuilds, minimumReleaseAge, trustPolicy, …) and .npmrc the registry, so
# both must be present at install time. --frozen-lockfile fails on any lockfile drift.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --prod

COPY . .

# The GLiNER ONNX weights must be present at build time (see README).
# They are copied in via `COPY . .` from the local model/ directory.

EXPOSE 8788
ENV PORT=8788
CMD ["node", "src/server.js"]
