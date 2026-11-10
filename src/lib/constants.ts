import type { JunctionCategory } from '@/types';

export const CATEGORY_META: Record<JunctionCategory, { label: string; emoji: string; color: string }> = {
  city: { label: 'City', emoji: '🏙️', color: '#3b82f6' },
  music: { label: 'Music', emoji: '🎵', color: '#ec4899' },
  gaming: { label: 'Gaming', emoji: '🎮', color: '#f59e0b' },
  study: { label: 'Study', emoji: '📚', color: '#10b981' },
  technology: { label: 'Technology', emoji: '💻', color: '#06b6d4' },
  friendship: { label: 'Friendship', emoji: '🤝', color: '#f97316' },
  language: { label: 'Language', emoji: '🌍', color: '#8b5cf6' },
  random: { label: 'Random', emoji: '🎲', color: '#ef4444' },
};

export const AVATAR_EMOJIS = [
  '🐼', '🐯', '🦊', '🦁', '🐶', '🐱', '🐰', '🐻', '🐨', '🐸',
  '🐵', '🦉', '🦄', '🐺', '🦝', '🐹', '🐷', '🐮', '🐔', '🐧',
  '🦋', '🐙', '🦕', '🐲', '🦓', '🦒', '🐠', '🐬', '🦜', '🐢',
];

export const AVATAR_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#ef4444', '#f97316',
  '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#10b981', '#14b8a6',
  '#06b6d4', '#0ea5e9', '#3b82f6', '#a855f7',
];

export const NICKNAME_ADJECTIVES = [
  'Curious', 'Silent', 'Happy', 'Random', 'Brave', 'Cosmic', 'Lazy', 'Mystic',
  'Witty', 'Gentle', 'Wild', 'Calm', 'Bold', 'Sneaky', 'Bright', 'Jolly',
  'Frosty', 'Sunny', 'Shy', 'Bold',
];

export const NICKNAME_ANIMALS = [
  'Panda', 'Tiger', 'Explorer', 'Fox', 'Wolf', 'Owl', 'Lion', 'Otter',
  'Koala', 'Falcon', 'Whale', 'Lynx', 'Bear', 'Hawk', 'Cat', 'Raven',
];

export const REACTION_EMOJIS = ['❤️', '😂', '😍', '🥰', '😎', '😭', '😡', '👍', '👎', '👏', '🙌', '🤝', '👋', '🔥', '✨', '💯', '🎉', '💪', '🙏', '🚀'];

export const HEARTBEAT_INTERVAL_MS = 25_000;
export const PRESENCE_TIMEOUT_MS = 90_000;

export function randomNickname(): string {
  const adj = NICKNAME_ADJECTIVES[Math.floor(Math.random() * NICKNAME_ADJECTIVES.length)];
  const animal = NICKNAME_ANIMALS[Math.floor(Math.random() * NICKNAME_ANIMALS.length)];
  return `${adj} ${animal}`;
}

export function randomAvatar() {
  const emoji = AVATAR_EMOJIS[Math.floor(Math.random() * AVATAR_EMOJIS.length)];
  const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
  return { emoji, color };
}
