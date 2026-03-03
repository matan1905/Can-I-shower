FROM oven/bun:1-alpine AS builder

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install

COPY . .
RUN bun run build

FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --production --frozen-lockfile || bun install --production

COPY --from=builder /app/public ./public
COPY shared.js model.json locations-latlong.json ./
COPY server ./server

EXPOSE 3000

CMD ["bun", "server/index.js"]
