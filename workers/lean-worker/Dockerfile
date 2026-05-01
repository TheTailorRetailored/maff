FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends curl git ca-certificates build-essential && rm -rf /var/lib/apt/lists/*
WORKDIR /worker
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY lean-template ./lean-template
RUN npm run build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl git ca-certificates build-essential && rm -rf /var/lib/apt/lists/*
ENV PATH="/root/.elan/bin:${PATH}"
ENV ELAN_HOME=/root/.elan
ENV LEAN_TOOLCHAIN=leanprover/lean4:stable
WORKDIR /worker
COPY --from=build /worker/node_modules ./node_modules
COPY --from=build /worker/dist ./dist
COPY --from=build /worker/lean-template ./lean-template
COPY package.json ./
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
EXPOSE 8765
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
