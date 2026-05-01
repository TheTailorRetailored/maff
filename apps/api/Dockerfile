FROM node:22-bookworm-slim AS deps
WORKDIR /app
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
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=deps /quartz /quartz
COPY quartz/quartz.config.ts quartz/quartz.layout.ts /quartz/
COPY apps/api/package.json ./
EXPOSE 3001
CMD ["sh", "-c", "npx prisma db push && node dist/index.js"]
