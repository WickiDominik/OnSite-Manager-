import { getSetting, setSetting } from '../db';
import type { CloudAccount } from './types';

export const K_ACCOUNTS = 'cloud.accounts';

export async function getAccounts(): Promise<CloudAccount[]> {
  return (await getSetting<CloudAccount[]>(K_ACCOUNTS)) ?? [];
}

export async function getAccount(id: string): Promise<CloudAccount | undefined> {
  return (await getAccounts()).find((a) => a.id === id);
}

export async function saveAccount(acc: CloudAccount): Promise<void> {
  const all = await getAccounts();
  const i = all.findIndex((a) => a.id === acc.id);
  if (i >= 0) all[i] = acc;
  else all.push(acc);
  await setSetting(K_ACCOUNTS, all);
}

export async function removeAccount(id: string): Promise<void> {
  await setSetting(
    K_ACCOUNTS,
    (await getAccounts()).filter((a) => a.id !== id),
  );
}
