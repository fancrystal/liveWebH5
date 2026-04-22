/**
 * Stateless WHIP protocol helper.
 * Encapsulates the HTTP exchange for WebRTC WHIP push.
 */
export class WHIPService {
  private whipUrl: string
  private pc: RTCPeerConnection | null = null

  private readonly ICE_SERVERS: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
  ]

  constructor(whipUrl: string) {
    this.whipUrl = whipUrl
  }

  async publish(stream: MediaStream): Promise<RTCPeerConnection> {
    const pc = new RTCPeerConnection({ iceServers: this.ICE_SERVERS })
    this.pc = pc

    stream.getTracks().forEach(t => pc.addTrack(t, stream))

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)

    await this.waitForIceGathering(pc)

    const res = await fetch(this.whipUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      body: pc.localDescription!.sdp,
    })

    if (!res.ok) throw new Error(`WHIP error ${res.status}: ${await res.text()}`)

    const sdp = await res.text()
    await pc.setRemoteDescription({ type: 'answer', sdp })

    return pc
  }

  stop() {
    this.pc?.close()
    this.pc = null
  }

  private waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
    return new Promise(resolve => {
      if (pc.iceGatheringState === 'complete') { resolve(); return }
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') resolve()
      }
    })
  }
}
