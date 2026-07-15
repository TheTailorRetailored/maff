FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY apps/api/package*.json ./
RUN npm ci
COPY apps/api/prisma ./prisma
RUN npx prisma generate
WORKDIR /quartz
COPY quartz/package*.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY apps/api/tsconfig.json ./
COPY apps/api/src ./src
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ARG TECTONIC_VERSION=0.16.9
ARG TECTONIC_SHA256=60b13a0826ae7ad9ce34b4a2df06bff2cfcfa6dda8a915477c0cbb84e1a4a902
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl \
  && curl -fsSL "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${TECTONIC_VERSION}/tectonic-${TECTONIC_VERSION}-x86_64-unknown-linux-musl.tar.gz" -o /tmp/tectonic.tar.gz \
  && echo "${TECTONIC_SHA256}  /tmp/tectonic.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/tectonic.tar.gz -C /usr/local/bin tectonic \
  && chmod 0755 /usr/local/bin/tectonic \
  && rm -rf /var/lib/apt/lists/* /tmp/tectonic.tar.gz
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=deps /quartz /quartz
COPY quartz/quartz.config.ts quartz/quartz.layout.ts /quartz/
COPY apps/api/package.json ./
EXPOSE 3001
CMD ["sh", "-c", "npx prisma db push && node dist/index.js"]
