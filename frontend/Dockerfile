FROM node:20-alpine AS builder
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY cli/package.json cli/package.json
COPY e2e/package.json e2e/package.json
RUN npm ci --workspace frontend
COPY frontend ./frontend
RUN npm run build --workspace frontend

FROM nginx:alpine
COPY --from=builder /workspace/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
