import { supabase } from './supabase';
import type { VoiceSignal } from '@/types';

type Peers = Map<string, RTCPeerConnection>;
type RemoteStreams = Map<string, MediaStream>;

interface VoiceManagerCallbacks {
  onRemoteStream: (sessionId: string, stream: MediaStream) => void;
  onPeerLeft: (sessionId: string) => void;
  onPeerJoined: (sessionId: string, nickname: string, avatarEmoji: string) => void;
  onSpeakingChange: (sessionId: string, speaking: boolean) => void;
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export class VoiceManager {
  private channel: ReturnType<typeof supabase.channel> | null = null;
  private peers: Peers = new Map();
  private remoteStreams: RemoteStreams = new Map();
  private localStream: MediaStream | null = null;
  private sessionId: string;
  private nickname: string;
  private avatarEmoji: string;
  private junctionId: string;
  private callbacks: VoiceManagerCallbacks;
  private speakingAnalysers: Map<string, { ctx: AudioContext; raf: number }> = new Map();
  private localAnalyser: { ctx: AudioContext; raf: number } | null = null;

  constructor(
    junctionId: string,
    sessionId: string,
    nickname: string,
    avatarEmoji: string,
    callbacks: VoiceManagerCallbacks,
  ) {
    this.junctionId = junctionId;
    this.sessionId = sessionId;
    this.nickname = nickname;
    this.avatarEmoji = avatarEmoji;
    this.callbacks = callbacks;
  }

  async join(): Promise<void> {
    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });

    const channelName = `voice:${this.junctionId}`;
    this.channel = supabase.channel(channelName, { config: { broadcast: { self: false } } });

    this.channel.on('broadcast', { event: 'signal' }, (payload) => {
      const signal = payload.payload as VoiceSignal;
      if ('to' in signal && signal.to && signal.to !== this.sessionId) return;
      this.handleSignal(signal);
    });

    await this.channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        this.broadcast({ type: 'hello', from: this.sessionId, nickname: this.nickname, avatarEmoji: this.avatarEmoji });
      }
    });

    this.startLocalSpeakingDetection();
  }

  private broadcast(signal: VoiceSignal) {
    this.channel?.send({ type: 'broadcast', event: 'signal', payload: signal });
  }

  private async handleSignal(signal: VoiceSignal) {
    switch (signal.type) {
      case 'hello': {
        if (signal.from === this.sessionId) return;
        if (this.peers.has(signal.from)) return;
        this.callbacks.onPeerJoined(signal.from, signal.nickname, signal.avatarEmoji);
        await this.createOffer(signal.from);
        break;
      }
      case 'offer': {
        if (signal.from === this.sessionId) return;
        await this.handleOffer(signal.from, signal.sdp);
        break;
      }
      case 'answer': {
        if (signal.from === this.sessionId) return;
        await this.handleAnswer(signal.from, signal.sdp);
        break;
      }
      case 'ice': {
        if (signal.from === this.sessionId) return;
        await this.handleIce(signal.from, signal.candidate);
        break;
      }
      case 'leave': {
        if (signal.from === this.sessionId) return;
        this.removePeer(signal.from);
        break;
      }
    }
  }

  private createPeer(sessionId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => pc.addTrack(track, this.localStream!));
    }

    pc.ontrack = (e) => {
      const stream = e.streams[0];
      this.remoteStreams.set(sessionId, stream);
      this.callbacks.onRemoteStream(sessionId, stream);
      this.startRemoteSpeakingDetection(sessionId, stream);
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.broadcast({ type: 'ice', from: this.sessionId, to: sessionId, candidate: e.candidate.toJSON() });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.removePeer(sessionId);
      }
    };

    this.peers.set(sessionId, pc);
    return pc;
  }

  private async createOffer(targetId: string): Promise<void> {
    const pc = this.createPeer(targetId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.broadcast({ type: 'offer', from: this.sessionId, to: targetId, sdp: offer });
  }

  private async handleOffer(fromId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    let pc = this.peers.get(fromId);
    if (!pc) {
      pc = this.createPeer(fromId);
    }
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.broadcast({ type: 'answer', from: this.sessionId, to: fromId, sdp: answer });
  }

  private async handleAnswer(fromId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    const pc = this.peers.get(fromId);
    if (!pc) return;
    if (pc.signalingState === 'stable') return;
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  }

  private async handleIce(fromId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const pc = this.peers.get(fromId);
    if (!pc) return;
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
      // ICE candidate may arrive before remote description — safe to ignore
    }
  }

  private removePeer(sessionId: string): void {
    const pc = this.peers.get(sessionId);
    if (pc) {
      pc.close();
      this.peers.delete(sessionId);
    }
    this.remoteStreams.delete(sessionId);
    this.stopRemoteSpeakingDetection(sessionId);
    this.callbacks.onPeerLeft(sessionId);
  }

  setMicMuted(muted: boolean): void {
    if (!this.localStream) return;
    this.localStream.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }

  private startLocalSpeakingDetection(): void {
    if (!this.localStream) return;
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(this.localStream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.6;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let speaking = false;

    const check = () => {
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      const avg = sum / data.length;
      const nowSpeaking = avg > 18 && this.localStream!.getAudioTracks()[0]?.enabled;
      if (nowSpeaking !== speaking) {
        speaking = nowSpeaking;
        this.callbacks.onSpeakingChange(this.sessionId, speaking);
      }
      this.localAnalyser = { ctx, raf: requestAnimationFrame(check) };
    };
    check();
  }

  private startRemoteSpeakingDetection(sessionId: string, stream: MediaStream): void {
    const existing = this.speakingAnalysers.get(sessionId);
    if (existing) return;
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.6;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let speaking = false;

    const check = () => {
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      const avg = sum / data.length;
      const nowSpeaking = avg > 18;
      if (nowSpeaking !== speaking) {
        speaking = nowSpeaking;
        this.callbacks.onSpeakingChange(sessionId, speaking);
      }
      this.speakingAnalysers.set(sessionId, { ctx, raf: requestAnimationFrame(check) });
    };
    check();
  }

  private stopRemoteSpeakingDetection(sessionId: string): void {
    const entry = this.speakingAnalysers.get(sessionId);
    if (entry) {
      cancelAnimationFrame(entry.raf);
      entry.ctx.close();
      this.speakingAnalysers.delete(sessionId);
    }
  }

  leave(): void {
    this.broadcast({ type: 'leave', from: this.sessionId });
    this.peers.forEach((pc) => pc.close());
    this.peers.clear();
    this.remoteStreams.clear();
    this.speakingAnalysers.forEach((entry) => {
      cancelAnimationFrame(entry.raf);
      entry.ctx.close();
    });
    this.speakingAnalysers.clear();
    if (this.localAnalyser) {
      cancelAnimationFrame(this.localAnalyser.raf);
      this.localAnalyser.ctx.close();
      this.localAnalyser = null;
    }
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    if (this.channel) {
      supabase.removeChannel(this.channel);
      this.channel = null;
    }
  }
}
