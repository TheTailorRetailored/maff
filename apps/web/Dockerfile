FROM node:22-bookworm-slim AS build
WORKDIR /app
ARG VITE_API_BASE_URL
ARG VITE_AUTH0_DOMAIN
ARG VITE_AUTH0_CLIENT_ID
ARG VITE_AUTH0_AUDIENCE
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_AUTH0_DOMAIN=$VITE_AUTH0_DOMAIN
ENV VITE_AUTH0_CLIENT_ID=$VITE_AUTH0_CLIENT_ID
ENV VITE_AUTH0_AUDIENCE=$VITE_AUTH0_AUDIENCE
COPY package*.json ./
RUN npm ci
COPY tsconfig.json index.html ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
RUN npm install -g serve
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["serve", "-s", "dist", "-l", "3000"]
