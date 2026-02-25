FROM node:20
WORKDIR /app

# Install dependencies (includes native module compilation)
COPY package*.json ./
RUN npm ci

# Copy pre-built dist (no rebuild needed)
COPY dist/ ./dist/

EXPOSE 3000
CMD ["node", "dist/server/index.js"]
