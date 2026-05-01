FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends curl git ca-certificates build-essential && rm -rf /var/lib/apt/lists/*
RUN curl https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh -sSf | sh -s -- -y
ENV PATH="/root/.elan/bin:${PATH}"
WORKDIR /worker
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY lean-template ./lean-template
RUN npm run build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl git ca-certificates build-essential && rm -rf /var/lib/apt/lists/*
RUN curl https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh -sSf | sh -s -- -y
ENV PATH="/root/.elan/bin:${PATH}"
WORKDIR /worker
COPY --from=build /worker/node_modules ./node_modules
COPY --from=build /worker/dist ./dist
COPY --from=build /worker/lean-template ./lean-template
COPY package.json ./
EXPOSE 8765
CMD ["node", "dist/server.js"]
