FROM node:20-alpine AS builder
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY cli/package.json cli/package.json
COPY e2e/package.json e2e/package.json
RUN npm ci --workspace backend
COPY backend ./backend
RUN npm run build --workspace backend

FROM node:20-alpine
WORKDIR /workspace
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY cli/package.json cli/package.json
COPY e2e/package.json e2e/package.json
RUN npm ci --omit=dev --workspace backend
COPY --from=builder /workspace/backend/dist ./backend/dist
WORKDIR /workspace/backend
EXPOSE 3001
CMD ["node", "dist/server.js"]
