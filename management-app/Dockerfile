# BoostPay mobile app image (agent / management console)
FROM node:20-bookworm-slim
WORKDIR /app
RUN npm i -g bun
COPY package.json bun.lock* package-lock.json* ./
RUN bun install
COPY . .
RUN bun run build
EXPOSE 3000
CMD ["bun","run","start"]
