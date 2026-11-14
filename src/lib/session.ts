import type { Session } from '@/types';
import { randomNickname, randomAvatar } from './constants';

const KEY = 'junction_session';
// A document gets its own room transport identity, including duplicated tabs.
// Persistent profile/Auth identity is deliberately stored separately.
const TAB_ID = crypto.randomUUID();

export function validDisplayName(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const name = value.trim();
  return name.length >= 2 && name.length <= 24
    && [...name].every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127);
}

export function loadSession(): Session | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!parsed || !validDisplayName(parsed.nickname ?? '')) return null;
    return {
      ...parsed,
      userId: parsed.userId ?? '',
      sessionId: TAB_ID,
      nameConfirmed: parsed.nameConfirmed ?? true,
    };
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  localStorage.setItem(KEY, JSON.stringify({
    userId: session.userId, nickname: session.nickname, avatarEmoji: session.avatarEmoji,
    avatarColor: session.avatarColor, createdAt: session.createdAt, nameConfirmed: session.nameConfirmed,
  }));
}

export function createSession(overrides?: Partial<Session>): Session {
  const avatar = randomAvatar();
  return {
    sessionId: TAB_ID,
    userId: '',
    nickname: randomNickname(),
    avatarEmoji: avatar.emoji,
    avatarColor: avatar.color,
    createdAt: Date.now(),
    nameConfirmed: false,
    ...overrides,
  };
}

export function clearSession(): void {
  localStorage.removeItem(KEY);
}
