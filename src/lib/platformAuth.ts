import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Platform login is optional: without configuration the app runs in local mode. */
export const authEnabled = !!(url && key);

export const supabase: SupabaseClient | null = authEnabled
  ? createClient(url!, key!, { auth: { persistSession: true, detectSessionInUrl: true, flowType: 'pkce' } })
  : null;

export type { Session };

const appUrl = () => window.location.origin + window.location.pathname;

export async function signInWithPassword(email: string, password: string) {
  const { error } = await supabase!.auth.signInWithPassword({ email, password });
  if (error) throw translate(error.message);
}

export async function signUp(email: string, password: string) {
  const { data, error } = await supabase!.auth.signUp({ email, password, options: { emailRedirectTo: appUrl() } });
  if (error) throw translate(error.message);
  return !data.session; // true → confirmation mail sent
}

export async function signInWithGoogle() {
  const { error } = await supabase!.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: appUrl() } });
  if (error) throw translate(error.message);
}

export async function sendPasswordReset(email: string) {
  const { error } = await supabase!.auth.resetPasswordForEmail(email, { redirectTo: appUrl() + '#/reset-password' });
  if (error) throw translate(error.message);
}

export async function updatePassword(password: string) {
  const { error } = await supabase!.auth.updateUser({ password });
  if (error) throw translate(error.message);
}

export async function signOut() {
  await supabase?.auth.signOut();
}

function translate(msg: string): Error {
  const m = msg.toLowerCase();
  if (m.includes('invalid login')) return new Error('E-Mail oder Passwort ist falsch.');
  if (m.includes('email not confirmed')) return new Error('Bitte bestätige zuerst deine E-Mail-Adresse.');
  if (m.includes('already registered')) return new Error('Für diese E-Mail existiert bereits ein Konto.');
  if (m.includes('password should be')) return new Error('Das Passwort ist zu kurz (mind. 6 Zeichen).');
  return new Error(msg);
}
