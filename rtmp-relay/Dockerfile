FROM node:20-alpine

# Install ffmpeg
RUN apk add --no-cache ffmpeg

WORKDIR /app
COPY package.json ./
RUN npm install --production

COPY server.js ./

ENV PORT=8080
ENV FFMPEG_PATH=ffmpeg

EXPOSE 8080

CMD ["node", "server.js"]
