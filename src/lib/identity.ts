import { supabase } from './supabase';
import { createSession, loadSession, saveSession, validDisplayName } from './session';
import type { Session } from '@/types';

let initializing: Promise<Session> | null = null;

async function initialize(): Promise<Session> {
  const resolveIdentity = async () => {
    let { data: { session: authSession } } = await supabase.auth.getSession();
    if (!authSession) {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) {
        if (error.code === 'anonymous_provider_disabled') {
          throw new Error('Guest sign-in is unavailable. Enable anonymous sign-ins in Supabase Auth.');
        }
        if (error.status === 429) throw new Error('Guest sign-in is temporarily rate limited. Please try again later.');
        if (error.code === 'captcha_failed') throw new Error('Guest sign-in requires CAPTCHA verification. Complete the configured verification before retrying.');
        throw new Error('Could not connect to guest sign-in. Check your connection and Supabase Auth settings, then try again.');
      }
      authSession = data.session;
    }
    if (!authSession) throw new Error('Could not establish a verified session.');
    return authSession;
  };
  const authSession = navigator.locks
    ? await navigator.locks.request('junction-auth-initialize', resolveIdentity)
    : await resolveIdentity();
  const user = authSession.user;
  await supabase.realtime.setAuth(authSession.access_token);
  const saved = loadSession();
  const local = saved && (!saved.userId || saved.userId === user.id) ? saved : createSession();
  const { data, error } = await supabase.from('junction_profiles').select('*').eq('user_id', user.id).maybeSingle();
  if (error) {
    if (error.code === 'PGRST205' || error.code === '42P01') {
      throw new Error('The Junction session migration must be reviewed and applied before rooms can be used.');
    }
    throw new Error('Could not load your Junction profile. Check your connection and profile access policies.');
  }
  const metadataName = user.user_metadata?.display_name;
  const profile: Session = data ? {
    ...local, userId: user.id, nickname: data.display_name,
    avatarEmoji: data.avatar_emoji, avatarColor: data.avatar_color, nameConfirmed: true,
  } : {
    ...local, userId: user.id,
    nickname: validDisplayName(metadataName ?? '') ? metadataName.trim() : local.nickname,
    nameConfirmed: validDisplayName(metadataName ?? '') || local.nameConfirmed,
  };
  if (profile.nameConfirmed) await persistProfile(profile);
  return profile;
}

export function initializeIdentity(): Promise<Session> {
  initializing ??= initialize().catch((error) => { initializing = null; throw error; });
  return initializing;
}

export async function persistProfile(profile: Session): Promise<void> {
  if (!validDisplayName(profile.nickname)) throw new Error('Use a display name between 2 and 24 characters.');
  const { error } = await supabase.from('junction_profiles').upsert({
    user_id: profile.userId,
    display_name: profile.nickname.trim(),
    avatar_emoji: profile.avatarEmoji,
    avatar_color: profile.avatarColor,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error('Could not save your profile. Please try again.');
  const { data } = await supabase.auth.getSession();
  if (data.session?.user && !data.session.user.is_anonymous) {
    const result = await supabase.auth.updateUser({
      data: { ...data.session.user.user_metadata, display_name: profile.nickname.trim() },
    });
    if (result.error) throw new Error('Could not update your account display name. Please retry.');
  }
  saveSession({ ...profile, nickname: profile.nickname.trim(), nameConfirmed: true });
}
