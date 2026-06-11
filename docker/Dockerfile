# ─── Build stage ───
FROM node:20-alpine AS build
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/workers/package.json apps/workers/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# ─── Production stage ───
FROM node:20-alpine AS production
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/workers/package.json apps/workers/
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/prompts ./dist/src/prompts
EXPOSE 3000
CMD ["node", "dist/apps/api/main.js"]
