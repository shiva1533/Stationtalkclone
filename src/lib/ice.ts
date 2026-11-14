import { supabase } from './supabase';

const STUN: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

export async function getIceConfiguration(): Promise<{ iceServers: RTCIceServer[]; expiresAt: number }> {
  const endpoint = import.meta.env.VITE_TURN_CREDENTIALS_URL?.trim();
  if (!endpoint) return { iceServers: STUN, expiresAt: Date.now() + 300_000 };
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error('Your session expired. Please reopen Junction.');
  const response = await fetch(endpoint, {
    headers: { Authorization: 'Bearer ' + data.session.access_token },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('The audio relay is unavailable. Please try connecting again.');
  const result = await response.json();
  if (!Array.isArray(result.iceServers) || !result.iceServers.length || !Number.isFinite(result.expiresAt)) {
    throw new Error('The audio relay returned an invalid configuration.');
  }
  return { iceServers: [...STUN, ...result.iceServers], expiresAt: result.expiresAt };
}
