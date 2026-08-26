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
# HOSTNAME=0.0.0.0 is REQUIRED, not cosmetic.
#
# Next.js standalone's server.js binds to process.env.HOSTNAME, and Docker sets
# HOSTNAME to the container ID. The server then listens ONLY on the container's
# own IP -- not on loopback -- so the HEALTHCHECK below (which probes
# 127.0.0.1) fails forever and the container is marked unhealthy.
#
# That is worse than a cosmetic status: Traefik's Docker provider EXCLUDES
# unhealthy containers, so it never creates a router and every request returns
# 404 from Traefik with no error anywhere. Confirmed live -- the container
# served fine on its own IP the whole time.
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
# Runs unprivileged: this process terminates HTTP and proxies mail traffic,
# so it has no reason to be root.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
# Port contract: app bind port == EXPOSE == container side of the compose
# mapping == healthcheck probe port. All four are 3000.
EXPOSE 3000

# Set at run time, no rebuild needed -- this is the whole reason it is not
# a NEXT_PUBLIC_ value.
ENV MAILBOX_API_BASE_URL="http://api:8080/api/v1"

# Socket probe, never pgrep: pgrep is absent from these images and would
# yield exit 127 forever, so the container would never report healthy.
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=40s \
  CMD node -e "require('net').connect(3000,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
