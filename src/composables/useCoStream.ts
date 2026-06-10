import { ref } from 'vue'
import { useCoStreamStore } from '@/stores/coStreamStore'
import { useMediaStore } from '@/stores/mediaStore'
import { signalService } from '@/services/SignalService'
import type { CoStreamParticipant } from '@/types/costream'

const ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
}

/**
 * WebRTC co-stream composable.
 *
 * The host creates one RTCPeerConnection per remote participant.
 * Signaling is routed through SignalService (socket.io).
 *
 * Demo mode: call addDemoParticipant() to test layout without a real server.
 */
export function useCoStream() {
  const coStreamStore = useCoStreamStore()
  const mediaStore    = useMediaStore()

  /** peerId → RTCPeerConnection */
  const pcs = new Map<string, RTCPeerConnection>()
  /** peerId → pending disconnect-grace timer */
  const disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const isActive = ref(false)

  // 'disconnected' is transient (NAT rebind / Wi-Fi handoff often self-heal in
  // seconds) — wait before kicking, mirroring useWebRTC's grace period.
  const DISCONNECT_GRACE_MS = 5_000

  /** signaling handler refs for cleanup */
  const sigHandlers = new Map<string, (...args: unknown[]) => void>()

  // ─── helpers ──────────────────────────────────────────────────────────────

  function createPc(peerId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection(ICE_CONFIG)
    pcs.set(peerId, pc)

    // Add host's local tracks so the remote peer receives them
    const camStream = mediaStore.cameraStream
    const micStream = mediaStore.micStream
    mediaStore.cameraStream?.getVideoTracks().forEach(t => pc.addTrack(t, camStream!))
    mediaStore.micStream?.getAudioTracks().forEach(t => pc.addTrack(t, micStream!))

    // Receive remote participant's stream
    const remoteStream = new MediaStream()
    pc.ontrack = (e) => {
      e.streams[0]?.getTracks().forEach(t => remoteStream.addTrack(t))
      coStreamStore.updateParticipant(peerId, { stream: remoteStream })
    }

    // Send ICE candidates to the peer
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        signalService.emit('ice', { to: peerId, candidate: e.candidate })
      }
    }

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState
      if (pcs.get(peerId) !== pc) return   // superseded connection — ignore

      if (state === 'connected') {
        // Recovered within the grace period — cancel the pending kick
        const timer = disconnectTimers.get(peerId)
        if (timer) { clearTimeout(timer); disconnectTimers.delete(peerId) }
        return
      }

      if (state === 'failed') {
        // Definitive ICE/DTLS failure — remove immediately
        closePeer(peerId)
        coStreamStore.removeParticipant(peerId)
        return
      }

      if (state === 'disconnected' && !disconnectTimers.has(peerId)) {
        disconnectTimers.set(peerId, setTimeout(() => {
          disconnectTimers.delete(peerId)
          if (pcs.get(peerId) !== pc) return
          if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            closePeer(peerId)
            coStreamStore.removeParticipant(peerId)
          }
        }, DISCONNECT_GRACE_MS))
      }
    }

    return pc
  }

  // ─── signaling actions ────────────────────────────────────────────────────

  async function callPeer(peerId: string) {
    closePeer(peerId)   // close any stale connection first
    const pc    = createPc(peerId)
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    signalService.emit('offer', { to: peerId, sdp: offer })
  }

  async function answerOffer(
    peerId: string,
    remoteSdp: RTCSessionDescriptionInit,
  ) {
    closePeer(peerId)   // close any stale connection first
    const pc = createPc(peerId)
    await pc.setRemoteDescription(remoteSdp)
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    signalService.emit('answer', { to: peerId, sdp: answer })
  }

  function closePeer(peerId: string) {
    const timer = disconnectTimers.get(peerId)
    if (timer) { clearTimeout(timer); disconnectTimers.delete(peerId) }
    const pc = pcs.get(peerId)
    if (pc) { pc.close(); pcs.delete(peerId) }
  }

  // ─── signal event handlers ─────────────────────────────────────────────────

  function setupSignaling() {
    // Prevent duplicate registration
    if (sigHandlers.size > 0) return

    const onUserJoined = async (data: unknown) => {
      try {
        const { userId, nickname, role } = data as {
          userId: string; nickname: string; role: CoStreamParticipant['role']
        }
        coStreamStore.addParticipant({
          id: userId, role, nickname, avatar: '',
          audioEnabled: true, videoEnabled: true,
          applyStatus: 'accepted', joinedAt: Date.now(),
        })
        await callPeer(userId)
      } catch { /* ignore signaling errors */ }
    }

    const onOffer = async (data: unknown) => {
      try {
        const { from, sdp } = data as { from: string; sdp: RTCSessionDescriptionInit }
        await answerOffer(from, sdp)
      } catch { /* ignore */ }
    }

    const onAnswer = async (data: unknown) => {
      try {
        const { from, sdp } = data as { from: string; sdp: RTCSessionDescriptionInit }
        const pc = pcs.get(from)
        if (pc) await pc.setRemoteDescription(sdp)
      } catch { /* ignore */ }
    }

    const onIce = async (data: unknown) => {
      try {
        const { from, candidate } = data as { from: string; candidate: RTCIceCandidateInit }
        const pc = pcs.get(from)
        if (pc && candidate) await pc.addIceCandidate(candidate)
      } catch { /* ignore */ }
    }

    const onUserLeft = (data: unknown) => {
      const { userId } = data as { userId: string }
      closePeer(userId)
      coStreamStore.removeParticipant(userId)
    }

    const onCoApply = (data: unknown) => {
      coStreamStore.addApply(data as CoStreamParticipant)
    }

    sigHandlers.set('user-joined', onUserJoined)
    sigHandlers.set('offer', onOffer)
    sigHandlers.set('answer', onAnswer)
    sigHandlers.set('ice', onIce)
    sigHandlers.set('user-left', onUserLeft)
    sigHandlers.set('co-apply', onCoApply)

    sigHandlers.forEach((handler, event) => signalService.on(event, handler))
  }

  function teardownSignaling() {
    sigHandlers.forEach((handler, event) => signalService.off(event, handler))
    sigHandlers.clear()
  }

  // ─── host actions ─────────────────────────────────────────────────────────

  function acceptApply(participantId: string) {
    coStreamStore.removeApply(participantId)
    signalService.emit('accept-apply', { userId: participantId })
  }

  function rejectApply(participantId: string) {
    coStreamStore.removeApply(participantId)
    signalService.emit('reject-apply', { userId: participantId })
  }

  function kickParticipant(participantId: string) {
    signalService.emit('kick', { userId: participantId })
    closePeer(participantId)
    coStreamStore.removeParticipant(participantId)
  }

  function toggleParticipantAudio(participantId: string) {
    const p = coStreamStore.participants.get(participantId)
    if (!p) return
    coStreamStore.updateParticipant(participantId, { audioEnabled: !p.audioEnabled })
    signalService.emit('mute-participant', {
      userId: participantId,
      audio: !p.audioEnabled,
    })
  }

  /** Start accepting co-stream guests. */
  function start() {
    isActive.value = true
    setupSignaling()
  }

  /** Close all peer connections and clear participants. */
  function stop() {
    isActive.value = false
    teardownSignaling()
    pcs.forEach((_, id) => closePeer(id))
    coStreamStore.clearAll()
  }

  // ─── demo / test helpers ──────────────────────────────────────────────────

  let demoCounter = 1

  /** Add a placeholder participant for layout testing (no real WebRTC). */
  function addDemoParticipant() {
    const id = `demo-${Date.now()}`
    coStreamStore.addParticipant({
      id,
      role: 'guest',
      nickname: `嘉宾 ${demoCounter++}`,
      avatar: '',
      audioEnabled: true,
      videoEnabled: true,
      applyStatus: 'accepted',
      joinedAt: Date.now(),
    })
  }

  function removeDemoParticipant() {
    const list = coStreamStore.participantList.filter(p => p.id.startsWith('demo-'))
    if (list.length === 0) return
    const last = list[list.length - 1]!
    coStreamStore.removeParticipant(last.id)
    if (demoCounter > 1) demoCounter--
  }

  return {
    isActive,
    start, stop,
    callPeer, closePeer,
    acceptApply, rejectApply, kickParticipant,
    toggleParticipantAudio,
    addDemoParticipant, removeDemoParticipant,
  }
}
