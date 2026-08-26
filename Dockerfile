# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts || npm install --omit=dev --ignore-scripts

FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts || npm install --ignore-scripts
COPY . .
# Branding is rendered in the browser, so it is inlined here at build time.
# The mail server URL deliberately is NOT -- see lib/webmail/server.ts.
ARG NEXT_PUBLIC_BRAND_NAME="Webmail"
ARG NEXT_PUBLIC_BRAND_MARK="✉"
ENV NEXT_PUBLIC_BRAND_NAME=$NEXT_PUBLIC_BRAND_NAME \
    NEXT_PUBLIC_BRAND_MARK=$NEXT_PUBLIC_BRAND_MARK \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
# Runs unprivileged: this process terminates HTTP and proxies mail traffic,
# so it has no reason to be root.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
# Set at run time, no rebuild needed.
ENV MAILBOX_API_BASE_URL="http://api:8080/api/v1"
CMD ["node", "server.js"]
