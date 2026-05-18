/**
 * RTMP Relay Server
 * Browser → WebSocket (WebM chunks) → ffmpeg → RTMP
 *
 * Usage: node server.js
 * Env:   PORT=8080  FFMPEG_PATH=/usr/bin/ffmpeg
 */

const http    = require('http')
const { WebSocketServer } = require('ws')
const { spawn } = require('child_process')
const url     = require('url')

const PORT         = process.env.PORT         || 8080
const FFMPEG_PATH  = process.env.FFMPEG_PATH  || 'ffmpeg'

const server = http.createServer((req, res) => {
  res.writeHead(200)
  res.end('RTMP Relay OK')
})

const wss = new WebSocketServer({ server, path: '/rtmp-relay' })

wss.on('connection', (ws, req) => {
  const query   = url.parse(req.url, true).query
  const rtmpUrl = query.rtmp

  if (!rtmpUrl) {
    console.error('[relay] missing ?rtmp= param')
    ws.close(1008, 'missing rtmp url')
    return
  }

  console.log(`[relay] new client → ${rtmpUrl}`)

  // ffmpeg: read WebM from stdin, push RTMP to target
  const ff = spawn(FFMPEG_PATH, [
    '-loglevel', 'warning',
    '-i', 'pipe:0',            // input from stdin (WebM stream)
    '-c:v', 'copy',            // pass-through video (already H264/VP8)
    '-c:a', 'aac',             // re-encode audio to AAC for RTMP
    '-ar', '44100',
    '-b:a', '128k',
    '-f', 'flv',               // output format
    rtmpUrl,                   // RTMP destination
  ])

  ff.stderr.on('data', d => process.stderr.write(`[ffmpeg] ${d}`))

  ff.on('close', (code) => {
    console.log(`[relay] ffmpeg exited code=${code}`)
    if (ws.readyState === ws.OPEN) ws.close()
  })

  ws.on('message', (data) => {
    if (ff.stdin.writable) {
      ff.stdin.write(data, (err) => {
        if (err) console.error('[relay] stdin write error:', err.message)
      })
    }
  })

  ws.on('close', () => {
    console.log('[relay] client disconnected')
    ff.stdin.end()
  })

  ws.on('error', (err) => {
    console.error('[relay] ws error:', err.message)
    ff.kill()
  })
})

server.listen(PORT, () => {
  console.log(`[relay] listening on ws://0.0.0.0:${PORT}/rtmp-relay`)
  console.log(`[relay] ffmpeg: ${FFMPEG_PATH}`)
})
