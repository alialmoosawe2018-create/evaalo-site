# --- Build TypeScript ---
FROM node:18-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# --- Production runtime ---
FROM node:18-alpine
WORKDIR /app

# fluent-ffmpeg يحتاج ffmpeg على السيرفر (ترقية الصوت / التحويل)
RUN apk add --no-cache ffmpeg

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

# مجلدات وقت التشغيل
RUN mkdir -p logs uploads/temp

ENV NODE_ENV=production

EXPOSE 3000

# Render يضبط PORT — الصحة على نفس المنفذ
HEALTHCHECK --interval=30s --timeout=10s --start-period=45s --retries=3 \
  CMD node -e "const p=process.env.PORT||'3000';require('http').get('http://127.0.0.1:'+p+'/api/health',(r)=>{r.resume();process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1));"

CMD ["node", "dist/server.js"]
