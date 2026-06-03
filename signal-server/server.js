/**
 * Signal server for liveAssistantH5
 *
 * Handles:
 *  - Room management (join-room, room-info)
 *  - Chat relay (chat-message)
 *  - Co-stream WebRTC signaling (offer/answer/ice, user-joined/left,
 *    co-apply, accept-apply, reject-apply, kick, mute-participant)
 *  - Whiteboard sync (wb:patch, wb:page-switch, wb:page-add,
 *    wb:page-remove, wb:full-state, wb:request-full-state)
 */

const { createServer } = require('http')
const { Server }       = require('socket.io')

const PORT    = process.env.PORT    || 3000
const ORIGINS = process.env.ORIGINS || '*'

const httpServer = createServer((req, res) => {
  // Simple health-check endpoint so Docker / k8s probes work
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('ok')
    return
  }
  res.writeHead(404)
  res.end()
})

const io = new Server(httpServer, {
  cors: {
    origin: ORIGINS,
    methods: ['GET', 'POST'],
  },
})

/**
 * roomId → Set<socketId>
 * Tracks all sockets in each room so we can broadcast viewer counts.
 */
const rooms = new Map()

/**
 * socketId → { roomId, userId, role }
 * Reverse index for fast lookup on disconnect.
 */
const socketMeta = new Map()

// ─── Helpers ────────────────────────────────────────────────────────────────

function getRoomSize(roomId) {
  return rooms.get(roomId)?.size ?? 0
}

function broadcastRoomInfo(roomId) {
  io.to(roomId).emit('room-info', { viewerCount: getRoomSize(roomId) })
}

// ─── Connection handler ──────────────────────────────────────────────────────

io.on('connection', (socket) => {
  const { roomId, userId, role } = socket.handshake.query
  console.log(`[connect] socket=${socket.id} user=${userId} role=${role} room=${roomId}`)

  // ── Room join ──────────────────────────────────────────────────────────────

  socket.on('join-room', (data) => {
    // data may carry additional info; query params are the primary source
    const rid = data?.roomId ?? roomId
    if (!rid) return

    socket.join(rid)

    if (!rooms.has(rid)) rooms.set(rid, new Set())
    rooms.get(rid).add(socket.id)

    socketMeta.set(socket.id, { roomId: rid, userId, role })

    broadcastRoomInfo(rid)

    // Notify other room members that someone joined (used by co-stream logic)
    socket.to(rid).emit('user-joined', {
      socketId: socket.id,
      userId,
      role,
    })

    console.log(`[join] ${userId} joined room ${rid} (${getRoomSize(rid)} total)`)
  })

  // Auto-join using query params (the frontend connects with query and may
  // skip explicit 'join-room' event in some paths)
  if (roomId) {
    socket.join(roomId)
    if (!rooms.has(roomId)) rooms.set(roomId, new Set())
    rooms.get(roomId).add(socket.id)
    socketMeta.set(socket.id, { roomId, userId, role })
    broadcastRoomInfo(roomId)
    socket.to(roomId).emit('user-joined', { socketId: socket.id, userId, role })
  }

  // ── Chat ───────────────────────────────────────────────────────────────────

  socket.on('chat-message', (msg) => {
    const meta = socketMeta.get(socket.id)
    if (!meta) return
    // Broadcast to everyone in the room including sender
    io.to(meta.roomId).emit('chat-message', {
      ...msg,
      from: socket.id,
      userId,
      timestamp: Date.now(),
    })
  })

  // ── Co-stream: P2P WebRTC relay ────────────────────────────────────────────
  // offer / answer / ice carry a `to` field (target socketId) so we route 1-to-1

  socket.on('offer', ({ to, offer }) => {
    io.to(to).emit('offer', { from: socket.id, offer })
  })

  socket.on('answer', ({ to, answer }) => {
    io.to(to).emit('answer', { from: socket.id, answer })
  })

  socket.on('ice', ({ to, candidate }) => {
    io.to(to).emit('ice', { from: socket.id, candidate })
  })

  // ── Co-stream: room-level events ───────────────────────────────────────────

  socket.on('co-apply', (data) => {
    // Guest wants to join co-stream; forward to host (broadcast to room)
    const meta = socketMeta.get(socket.id)
    if (!meta) return
    socket.to(meta.roomId).emit('co-apply', { from: socket.id, ...data })
  })

  socket.on('accept-apply', ({ to, ...rest }) => {
    io.to(to).emit('accept-apply', { from: socket.id, ...rest })
  })

  socket.on('reject-apply', ({ to, ...rest }) => {
    io.to(to).emit('reject-apply', { from: socket.id, ...rest })
  })

  socket.on('kick', ({ to }) => {
    io.to(to).emit('kick')
  })

  socket.on('mute-participant', ({ to, muted }) => {
    io.to(to).emit('mute-participant', { muted })
  })

  // ── Whiteboard sync ────────────────────────────────────────────────────────
  // All wb:* events are broadcast to the rest of the room

  const WB_EVENTS = [
    'wb:patch',
    'wb:page-switch',
    'wb:page-add',
    'wb:page-remove',
    'wb:full-state',
  ]

  WB_EVENTS.forEach((event) => {
    socket.on(event, (data) => {
      const meta = socketMeta.get(socket.id)
      if (!meta) return
      socket.to(meta.roomId).emit(event, { ...data, from: socket.id })
    })
  })

  // A joining viewer requests the current full whiteboard state from the host
  socket.on('wb:request-full-state', () => {
    const meta = socketMeta.get(socket.id)
    if (!meta) return
    // Forward the request to everyone else (host will respond with wb:full-state)
    socket.to(meta.roomId).emit('wb:request-full-state', { from: socket.id })
  })

  // ── Disconnect ─────────────────────────────────────────────────────────────

  socket.on('disconnect', () => {
    const meta = socketMeta.get(socket.id)
    if (!meta) return

    const { roomId: rid } = meta
    rooms.get(rid)?.delete(socket.id)
    if (rooms.get(rid)?.size === 0) rooms.delete(rid)
    socketMeta.delete(socket.id)

    broadcastRoomInfo(rid)
    io.to(rid).emit('user-left', { socketId: socket.id, userId })

    console.log(`[disconnect] ${userId} left room ${rid} (${getRoomSize(rid)} remaining)`)
  })
})

// ─── Start ───────────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`Signal server listening on port ${PORT}`)
})
