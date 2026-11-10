export interface Junction {
  id: string;
  name: string;
  slug: string;
  category: JunctionCategory;
  description: string;
  image_url: string;
  city: string | null;
  is_permanent: boolean;
  slow_mode_seconds: number;
  creator_session_id: string | null;
  created_at: string;
}

export type JunctionCategory =
  | 'city'
  | 'music'
  | 'gaming'
  | 'study'
  | 'technology'
  | 'friendship'
  | 'language'
  | 'random';

export interface Participant {
  id: string;
  junction_id: string;
  session_id: string;
  nickname: string;
  avatar_emoji: string;
  avatar_color: string;
  in_voice: boolean;
  mic_muted: boolean;
  is_speaking: boolean;
  hand_raised: boolean;
  last_heartbeat: string;
  joined_at: string;
  left_at: string | null;
}

export interface Message {
  id: string;
  junction_id: string;
  session_id: string;
  nickname: string;
  avatar_emoji: string;
  avatar_color: string;
  content: string;
  reply_to: string | null;
  created_at: string;
}

export interface Reaction {
  id: string;
  message_id: string;
  junction_id: string;
  session_id: string;
  emoji: string;
  created_at: string;
}

export interface Session {
  sessionId: string;
  nickname: string;
  avatarEmoji: string;
  avatarColor: string;
  createdAt: number;
}

export type VoiceSignal =
  | { type: 'offer'; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { type: 'answer'; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { type: 'ice'; from: string; to: string; candidate: RTCIceCandidateInit }
  | { type: 'leave'; from: string }
  | { type: 'hello'; from: string; nickname: string; avatarEmoji: string };
