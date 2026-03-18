FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src/ src/
RUN npx tsc

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system intel && adduser --system --ingroup intel intel
COPY --from=builder /app/dist/ dist/
COPY --from=builder /app/node_modules/ node_modules/
COPY package.json ./
USER intel
EXPOSE 3000
ENTRYPOINT ["node", "dist/index.js"]
