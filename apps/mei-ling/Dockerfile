FROM node:24-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    MEI_PUBLIC_DEMO=1 \
    MEI_MODEL_PROVIDER=gemini \
    MEI_PUBLIC_BASE_PATH=/meiling \
    MEI_DISABLE_SCHEDULER=1 \
    MEI_BRAIN_DB=/tmp/mei-ling-demo.sqlite

WORKDIR /app
COPY package.json ./
COPY server.mjs ./
COPY brain ./brain
COPY public ./public

USER node
EXPOSE 8080
CMD ["node", "--no-warnings", "server.mjs"]
