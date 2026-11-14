import { supabase } from './supabase';
import { getIceConfiguration } from './ice';

export type VoiceConnectionState = 'Connecting' | 'Connected' | 'Reconnecting' | 'Disconnected' | 'Failed';

interface VoiceCallbacks {
  onSpeakingChange: (sessionId: string, speaking: boolean) => void;
  onStateChange: (state: VoiceConnectionState) => void;
  onAutoplayBlocked: (blocked: boolean) => void;
  onError: (message: string) => void;
}

interface Signal {
  type: 'hello' | 'description' | 'ice' | 'leave';
  from: string;
  to?: string;
  instance: string;
  publishing: boolean;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

interface Peer {
  pc: RTCPeerConnection;
  transceiver: RTCRtpTransceiver;
  instance: string;
  makingOffer: boolean;
  ignoreOffer: boolean;
  settingAnswer: boolean;
  candidates: RTCIceCandidateInit[];
  queue: Promise<void>;
  restartTimer: ReturnType<typeof setTimeout> | null;
  retries: number;
}

export class VoiceManager {
  private channel: ReturnType<typeof supabase.channel> | null = null;
  private peers = new Map<string, Peer>();
  private members = new Map<string, { instance: string; publishing: boolean }>();
  private departedInstances = new Map<string, string>();
  private departures = new Map<string, ReturnType<typeof setTimeout>>();
  private audio = new Map<string, HTMLAudioElement>();
  private localStream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private analysers = new Map<string, { source: MediaStreamAudioSourceNode; analyser: AnalyserNode; speaking: boolean }>();
  private analysisTimer: ReturnType<typeof setInterval> | null = null;
  private helloTimer: ReturnType<typeof setInterval> | null = null;
  private iceRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private connectPromise: Promise<void> | null = null;
  private publishPromise: Promise<void> | null = null;
  private publicationVersion = 0;
  private closed = false;
  private speakerOn = true;
  private muted = new Set<string>();
  private instance = crypto.randomUUID();
  private ice: Awaited<ReturnType<typeof getIceConfiguration>> | null = null;

  constructor(private roomId: string, private sessionId: string, private callbacks: VoiceCallbacks) {}

  connect(): Promise<void> {
    this.connectPromise ??= this.open();
    return this.connectPromise;
  }

  private async open() {
    this.callbacks.onStateChange('Connecting');
    this.ice = await getIceConfiguration();
    if (this.closed) return;
    this.scheduleIceRefresh();
    const channel = supabase.channel(`voice:${this.roomId}`, {
      config: { private: true, presence: { key: this.sessionId }, broadcast: { self: false, ack: true } },
    });
    this.channel = channel;
    channel.on('broadcast', { event: 'signal' }, ({ payload }) => {
      const signal = payload as Signal;
      if (this.closed || signal.from === this.sessionId || (signal.to && signal.to !== this.sessionId)) return;
      if (typeof signal.from !== 'string' || typeof signal.instance !== 'string') return;
      this.receive(signal);
    });
    channel.on('presence', { event: 'sync' }, () => {
      if (this.closed) return;
      const visible = new Map<string, { instance: string; publishing: boolean }>();
      for (const entries of Object.values(channel.presenceState<{ session_id: string; instance: string; publishing: boolean }>())) {
        for (const entry of entries) {
          if (entry.session_id === this.sessionId || this.departedInstances.get(entry.session_id) === entry.instance) continue;
          this.departedInstances.delete(entry.session_id);
          visible.set(entry.session_id, entry);
        }
      }
      for (const [id, member] of this.members) {
        if (visible.has(id)) {
          const timer = this.departures.get(id);
          if (timer) clearTimeout(timer);
          this.departures.delete(id);
          continue;
        }
        // Signaling may briefly disappear while the peer-to-peer audio is healthy.
        // Explicit leave messages are immediate; transport loss gets a grace period.
        if (!this.departures.has(id)) {
          this.departures.set(id, setTimeout(() => {
            this.departures.delete(id);
            this.members.delete(id);
            this.removePeer(id);
            this.updateState();
          }, 12_000));
        }
        visible.set(id, member);
      }
      this.members = visible;
      for (const [id, member] of visible) this.syncPeer(id, member);
      this.updateState();
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Audio signaling did not connect. Please retry.')), 12_000);
      channel.subscribe((status) => {
        if (this.closed) { clearTimeout(timeout); resolve(); return; }
        if (status === 'SUBSCRIBED') {
          clearTimeout(timeout);
          void this.announce();
          this.updateState();
          resolve();
        } else this.callbacks.onStateChange('Reconnecting');
      });
    });
    if (this.closed) return;
    this.helloTimer = setInterval(() => { void this.broadcast({ type: 'hello' }); }, 15_000);
    window.addEventListener('online', this.recover);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  private async announce() {
    if (this.closed || !this.channel) return;
    await this.channel.track({ session_id: this.sessionId, instance: this.instance, publishing: Boolean(this.localStream) });
    await this.broadcast({ type: 'hello' });
  }

  private async broadcast(signal: Pick<Signal, 'type'> & Partial<Signal>) {
    if (!this.channel || this.closed) return;
    const result = await this.channel.send({
      type: 'broadcast', event: 'signal',
      payload: { ...signal, from: this.sessionId, instance: this.instance, publishing: Boolean(this.localStream) },
    });
    if (result !== 'ok' && !this.closed) this.callbacks.onStateChange('Reconnecting');
  }

  private syncPeer(id: string, member: { instance: string; publishing: boolean }) {
    const old = this.peers.get(id);
    if (old && old.instance !== member.instance) this.removePeer(id);
    if (!this.localStream && !member.publishing) { this.removePeer(id); return; }
    if (!this.peers.has(id)) this.createPeer(id, member.instance);
  }

  private createPeer(id: string, instance: string): Peer {
    const pc = new RTCPeerConnection({ iceServers: this.ice?.iceServers ?? [] });
    const track = this.localStream?.getAudioTracks()[0];
    const transceiver = track
      ? pc.addTransceiver(track, { direction: 'sendrecv', streams: [this.localStream!] })
      : pc.addTransceiver('audio', { direction: 'recvonly' });
    const peer: Peer = {
      pc, transceiver, instance, makingOffer: false, ignoreOffer: false, settingAnswer: false,
      candidates: [], queue: Promise.resolve(), restartTimer: null, retries: 0,
    };
    this.peers.set(id, peer);
    pc.onnegotiationneeded = () => this.enqueue(id, peer, async () => {
      if (pc.signalingState !== 'stable') return;
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        await this.broadcast({ type: 'description', to: id, description: pc.localDescription!.toJSON() });
      } finally { peer.makingOffer = false; }
    });
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) void this.broadcast({ type: 'ice', to: id, candidate: candidate.toJSON() });
    };
    pc.ontrack = ({ track: remoteTrack, streams }) => {
      if (this.closed || this.peers.get(id) !== peer) return;
      const stream = streams[0] ?? new MediaStream([remoteTrack]);
      let audio = this.audio.get(id);
      if (!audio) {
        audio = new Audio();
        audio.autoplay = true;
        audio.setAttribute('playsinline', '');
        audio.hidden = true;
        document.body.append(audio);
        this.audio.set(id, audio);
      }
      if (audio.srcObject !== stream) audio.srcObject = stream;
      audio.muted = !this.speakerOn || this.muted.has(id);
      void this.play(audio);
      this.analyse(id, stream);
    };
    pc.onconnectionstatechange = () => {
      if (this.closed || this.peers.get(id) !== peer) return;
      if (pc.connectionState === 'connected') {
        peer.retries = 0;
        if (peer.restartTimer) clearTimeout(peer.restartTimer);
        peer.restartTimer = null;
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        this.scheduleRestart(id, peer, pc.connectionState === 'failed' ? 0 : 3000);
      }
      this.updateState();
    };
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') this.scheduleRestart(id, peer, 0);
    };
    return peer;
  }

  private enqueue(id: string, peer: Peer, operation: () => Promise<void>) {
    peer.queue = peer.queue.then(async () => {
      if (!this.closed && this.peers.get(id) === peer) await operation();
    }).catch(() => {
      if (!this.closed && this.peers.get(id) === peer) this.scheduleRestart(id, peer, 1500);
    });
  }

  private receive(signal: Signal) {
    // Presence owns peer identity. Late packets from a departed/replaced audio
    // instance must not recreate it or overwrite a newer publishing state.
    const member = this.members.get(signal.from);
    if (!member || member.instance !== signal.instance) return;
    if (signal.type === 'leave') {
      this.departedInstances.set(signal.from, signal.instance);
      const timer = this.departures.get(signal.from);
      if (timer) clearTimeout(timer);
      this.departures.delete(signal.from);
      this.members.delete(signal.from);
      this.removePeer(signal.from);
      this.updateState();
      return;
    }
    this.syncPeer(signal.from, member);
    const peer = this.peers.get(signal.from);
    if (!peer || signal.type === 'hello') return;
    this.enqueue(signal.from, peer, async () => {
      const pc = peer.pc;
      if (signal.description) {
        const description = signal.description;
        const readyForOffer = !peer.makingOffer && (pc.signalingState === 'stable' || peer.settingAnswer);
        const collision = description.type === 'offer' && !readyForOffer;
        const polite = this.sessionId.localeCompare(signal.from) > 0;
        peer.ignoreOffer = !polite && collision;
        if (peer.ignoreOffer) return;
        peer.settingAnswer = description.type === 'answer';
        try {
          if (collision && polite && pc.signalingState !== 'stable') await pc.setLocalDescription({ type: 'rollback' });
          await pc.setRemoteDescription(description);
        } finally { peer.settingAnswer = false; }
        for (const candidate of peer.candidates.splice(0)) await this.addCandidate(peer, candidate);
        if (description.type === 'offer') {
          await pc.setLocalDescription();
          await this.broadcast({ type: 'description', to: signal.from, description: pc.localDescription!.toJSON() });
        }
      } else if (signal.candidate && !peer.ignoreOffer) {
        if (!pc.remoteDescription) peer.candidates.push(signal.candidate);
        else await this.addCandidate(peer, signal.candidate);
      }
    });
  }

  private async addCandidate(peer: Peer, candidate: RTCIceCandidateInit) {
    // Candidates from an older ICE generation must not poison a restarted peer.
    if (candidate.usernameFragment && !peer.pc.remoteDescription?.sdp.includes('a=ice-ufrag:' + candidate.usernameFragment)) return;
    await peer.pc.addIceCandidate(candidate);
  }

  private scheduleRestart(id: string, peer: Peer, delay: number) {
    if (this.closed || peer.restartTimer || this.peers.get(id) !== peer) return;
    this.callbacks.onStateChange('Reconnecting');
    peer.restartTimer = setTimeout(async () => {
      peer.restartTimer = null;
      if (this.closed || this.peers.get(id) !== peer || peer.pc.connectionState === 'connected') return;
      if (!navigator.onLine) { this.scheduleRestart(id, peer, 3000); return; }
      if (peer.retries >= 3) {
        this.callbacks.onStateChange('Failed');
        this.callbacks.onError('Audio could not reconnect. Check your connection and try Enable audio.');
        return;
      }
      try {
        if (!this.ice || this.ice.expiresAt - Date.now() < 60_000) this.ice = await getIceConfiguration();
        if (this.closed || this.peers.get(id) !== peer) return;
        peer.pc.setConfiguration({ iceServers: this.ice.iceServers });
        peer.retries++;
        peer.pc.restartIce();
        this.scheduleRestart(id, peer, Math.min(10_000, 2000 * peer.retries));
      } catch {
        this.scheduleRestart(id, peer, 5000);
      }
    }, delay);
  }

  private updateState() {
    if (this.closed) return;
    const peers = [...this.peers.values()];
    if (peers.some(({ pc }) => pc.connectionState === 'failed' || pc.connectionState === 'disconnected')) {
      this.callbacks.onStateChange('Reconnecting');
    } else if (peers.some(({ pc }) => pc.connectionState !== 'connected')) {
      this.callbacks.onStateChange('Connecting');
    } else this.callbacks.onStateChange('Connected');
  }

  private scheduleIceRefresh() {
    if (this.iceRefreshTimer) clearTimeout(this.iceRefreshTimer);
    if (!this.ice || !this.ice.iceServers.some(({ urls }) => (Array.isArray(urls) ? urls : [urls]).some((url) => /^turns?:/i.test(url)))) return;
    this.iceRefreshTimer = setTimeout(async () => {
      if (this.closed) return;
      try {
        this.ice = await getIceConfiguration();
        if (this.closed) return;
        for (const peer of this.peers.values()) {
          peer.pc.setConfiguration({ iceServers: this.ice.iceServers });
          peer.pc.restartIce();
        }
        this.scheduleIceRefresh();
      } catch {
        if (!this.closed) {
          this.callbacks.onError('Could not refresh the audio relay. Reconnecting…');
          this.iceRefreshTimer = setTimeout(() => this.scheduleIceRefresh(), 15_000);
        }
      }
    }, Math.max(1000, this.ice.expiresAt - Date.now() - 60_000));
  }

  async startPublishing() {
    if (this.localStream) return;
    if (this.publishPromise) return this.publishPromise;
    const version = ++this.publicationVersion;
    this.publishPromise = (async () => {
      await this.connect();
      if (this.closed || version !== this.publicationVersion) return;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false,
      });
      if (this.closed || version !== this.publicationVersion) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.localStream = stream;
      const track = stream.getAudioTracks()[0];
      track.enabled = false;
      for (const peer of this.peers.values()) {
        peer.transceiver.sender.setStreams(stream);
        await peer.transceiver.sender.replaceTrack(track);
        peer.transceiver.direction = 'sendrecv';
      }
      this.analyse(this.sessionId, stream);
      await this.enableAudio();
      await this.announce();
      for (const [id, member] of this.members) this.syncPeer(id, member);
    })().catch(async (error) => {
      await this.stopPublishing();
      throw error;
    }).finally(() => { this.publishPromise = null; });
    return this.publishPromise;
  }

  async stopPublishing() {
    ++this.publicationVersion;
    const stream = this.localStream;
    this.localStream = null;
    stream?.getTracks().forEach((track) => track.stop());
    this.stopAnalysis(this.sessionId);
    await Promise.all([...this.peers.values()].map(async (peer) => {
      if (peer.pc.signalingState === 'closed') return;
      await peer.transceiver.sender.replaceTrack(null);
      peer.transceiver.direction = 'recvonly';
    }));
    if (!this.closed) {
      await this.announce();
      for (const [id, member] of this.members) this.syncPeer(id, member);
    }
  }

  setMicMuted(muted: boolean) {
    this.localStream?.getAudioTracks().forEach((track) => { track.enabled = !muted; });
    if (muted) this.callbacks.onSpeakingChange(this.sessionId, false);
  }

  setSpeakerOn(enabled: boolean) {
    this.speakerOn = enabled;
    this.audio.forEach((audio, id) => { audio.muted = !enabled || this.muted.has(id); });
  }

  setPeerMuted(id: string, muted: boolean) {
    if (muted) this.muted.add(id); else this.muted.delete(id);
    const audio = this.audio.get(id);
    if (audio) audio.muted = !this.speakerOn || muted;
  }

  private async play(audio: HTMLAudioElement) {
    try { await audio.play(); }
    catch { if (!this.closed) this.callbacks.onAutoplayBlocked(true); }
  }

  async enableAudio() {
    const attempts = [...this.audio.values()].map((audio) => audio.play());
    if (this.context?.state === 'suspended') attempts.push(this.context.resume());
    const outcomes = await Promise.allSettled(attempts);
    this.callbacks.onAutoplayBlocked(outcomes.some((outcome) => outcome.status === 'rejected'));
    this.recover();
  }

  private analyse(id: string, stream: MediaStream) {
    this.stopAnalysis(id);
    try {
      this.context ??= new AudioContext();
      const source = this.context.createMediaStreamSource(stream);
      const analyser = this.context.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      this.analysers.set(id, { source, analyser, speaking: false });
      this.analysisTimer ??= setInterval(() => {
        for (const [sessionId, entry] of this.analysers) {
          const values = new Uint8Array(entry.analyser.frequencyBinCount);
          entry.analyser.getByteFrequencyData(values);
          const speaking = values.reduce((sum, value) => sum + value, 0) / values.length > 18
            && (sessionId !== this.sessionId || Boolean(this.localStream?.getAudioTracks()[0]?.enabled));
          if (speaking !== entry.speaking) {
            entry.speaking = speaking;
            this.callbacks.onSpeakingChange(sessionId, speaking);
          }
        }
      }, 150);
    } catch { /* Speaking meters are optional; audio playback continues. */ }
  }

  private stopAnalysis(id: string) {
    const entry = this.analysers.get(id);
    entry?.source.disconnect();
    this.analysers.delete(id);
    this.callbacks.onSpeakingChange(id, false);
  }

  private removePeer(id: string) {
    // Removing an idle audio peer must not cancel the room-presence expiry.
    // Receive-only members may have no peer at all while they are departing.
    const peer = this.peers.get(id);
    this.peers.delete(id);
    if (peer) {
      if (peer.restartTimer) clearTimeout(peer.restartTimer);
      peer.pc.onconnectionstatechange = null;
      peer.pc.oniceconnectionstatechange = null;
      peer.pc.onnegotiationneeded = null;
      peer.pc.close();
    }
    const audio = this.audio.get(id);
    if (audio) { audio.pause(); audio.srcObject = null; audio.remove(); }
    this.audio.delete(id);
    this.stopAnalysis(id);
  }

  private recover = () => {
    if (this.closed) return;
    for (const [id, peer] of this.peers) {
      if (peer.pc.connectionState === 'failed' || peer.pc.connectionState === 'disconnected') {
        peer.retries = 0;
        this.scheduleRestart(id, peer, 0);
      }
    }
    void this.broadcast({ type: 'hello' });
  };

  private onVisibility = () => {
    if (document.visibilityState === 'visible') {
      void this.enableAudio();
      this.recover();
    }
  };

  leave() {
    if (this.closed) return;
    void this.broadcast({ type: 'leave' });
    this.closed = true;
    ++this.publicationVersion;
    window.removeEventListener('online', this.recover);
    document.removeEventListener('visibilitychange', this.onVisibility);
    if (this.helloTimer) clearInterval(this.helloTimer);
    if (this.iceRefreshTimer) clearTimeout(this.iceRefreshTimer);
    if (this.analysisTimer) clearInterval(this.analysisTimer);
    this.departures.forEach(clearTimeout);
    this.departures.clear();
    this.localStream?.getTracks().forEach((track) => track.stop());
    this.localStream = null;
    for (const id of [...this.peers.keys()]) this.removePeer(id);
    if (this.context) void this.context.close();
    this.context = null;
    if (this.channel) void supabase.removeChannel(this.channel);
    this.channel = null;
    this.callbacks.onStateChange('Disconnected');
  }
}
