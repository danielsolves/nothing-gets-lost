# services/mailer/Dockerfile
# Image for the mailer (port 3005). It needs SMTP_URL and MAIL_FROM at boot;
# compose supplies a dead default so the demo starts without a mail account, and
# the send then fails visibly instead of the whole stack refusing to come up.
FROM node:22-alpine AS deps
WORKDIR /app
# Manifests before sources: this install layer is identical in every service
# image, so Docker builds it once and the others reuse it from cache.
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY services/api/package.json services/api/
COPY services/egress-gate/package.json services/egress-gate/
COPY services/extractor/package.json services/extractor/
COPY services/ledger/package.json services/ledger/
COPY services/mailer/package.json services/mailer/
COPY services/mcp/package.json services/mcp/
COPY services/mediator/package.json services/mediator/
COPY ui/package.json ui/
RUN npm ci --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
# tsx reads the compiler options from here; without them the decorators in every
# Nest controller fail to transform and the service exits on its first import.
COPY tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY services/mailer ./services/mailer
USER node
EXPOSE 3005
CMD ["node_modules/.bin/tsx", "services/mailer/src/main.ts"]
