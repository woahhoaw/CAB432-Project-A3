# Multi-stage build for a small production image
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Create and persist data directories
RUN mkdir -p /data/uploads /data/logs /data/db /data/events
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "app.js"]
