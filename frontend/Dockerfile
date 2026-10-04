# syntax=docker/dockerfile:1
# TravelMind web image: the built SPA served by nginx. The nginx config is mounted by
# deploy/docker-compose.yml (deploy/nginx/nginx.conf), which also proxies /api to the backend.

# Node 24: package.json engines and CI.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# Unprivileged nginx: runs as uid 101 and listens on 8080, so the container needs no capabilities.
FROM nginxinc/nginx-unprivileged:1.29-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
