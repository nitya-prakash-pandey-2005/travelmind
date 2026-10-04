# syntax=docker/dockerfile:1
# TravelMind web image: the built SPA served by nginx. The nginx config is mounted by
# deploy/docker-compose.yml (deploy/nginx/nginx.conf), which also proxies /api to the backend.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:1.29-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
