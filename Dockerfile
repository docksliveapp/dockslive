# Build and runtime stage for Cloud Run / Firebase App Hosting
FROM node:24-alpine

WORKDIR /app

COPY package*.json .npmrc* ./
RUN npm install --legacy-peer-deps

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.cjs"]
