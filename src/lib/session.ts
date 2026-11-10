import type { Session } from '@/types';
import { randomNickname, randomAvatar } from './constants';

const KEY = 'junction_session';

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (!parsed.sessionId || !parsed.nickname) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  localStorage.setItem(KEY, JSON.stringify(session));
}

export function createSession(overrides?: Partial<Session>): Session {
  const avatar = randomAvatar();
  const session: Session = {
    sessionId: crypto.randomUUID(),
    nickname: randomNickname(),
    avatarEmoji: avatar.emoji,
    avatarColor: avatar.color,
    createdAt: Date.now(),
    ...overrides,
  };
  saveSession(session);
  return session;
}

export function clearSession(): void {
  localStorage.removeItem(KEY);
}
