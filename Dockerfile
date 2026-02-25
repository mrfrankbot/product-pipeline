FROM node:20
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy all source files
COPY . .

# Build (TypeScript + Vite client bundle)
RUN npm run build

EXPOSE 3000
CMD ["node", "dist/server/index.js"]
