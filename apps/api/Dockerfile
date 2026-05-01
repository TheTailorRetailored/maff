FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY prisma ./prisma
RUN npx prisma generate

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json ./
EXPOSE 3001
CMD ["sh", "-c", "npx prisma db push && node dist/index.js"]
