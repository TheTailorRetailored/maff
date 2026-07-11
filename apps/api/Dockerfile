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
# Quartz's CLI expects to run from a complete Quartz workspace: its components
# import both ./quartz/* and root metadata such as package.json. The Git package
# is nested under node_modules, so materialize that pinned workspace while
# retaining the already-installed dependency tree.
RUN cp -a node_modules/@jackyzha0/quartz /tmp/quartz-source \
    && cp -a /tmp/quartz-source/. /quartz/ \
    && rm -rf /tmp/quartz-source

FROM deps AS build
WORKDIR /app
COPY apps/api/tsconfig.json ./
COPY apps/api/src ./src
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=deps /quartz /quartz
COPY quartz/quartz.config.ts quartz/quartz.layout.ts /quartz/
COPY apps/api/package.json ./
EXPOSE 3001
CMD ["sh", "-c", "npx prisma db push && node dist/index.js"]
