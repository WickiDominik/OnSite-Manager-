// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { downloadEntry, getAccounts, listFolder, saveAccount } from '../cloud';
import { connectNextcloud, normalizeNextcloudUrl, parsePropfind } from '../cloud/nextcloud';
import { mapDriveItem } from '../cloud/onedrive';
import type { NextcloudAccount, OneDriveAccount } from '../cloud/types';

const PROPFIND = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns" xmlns:oc="http://owncloud.org/ns">
 <d:response><d:href>/nc/remote.php/dav/files/dwicki/Projekte/</d:href>
  <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
 <d:response><d:href>/nc/remote.php/dav/files/dwicki/Projekte/MFH%20Seefeld/</d:href>
  <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype><d:getlastmodified>Wed, 04 Nov 2026 10:00:00 GMT</d:getlastmodified></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  <d:propstat><d:prop><d:getcontentlength/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response>
 <d:response><d:href>/nc/remote.php/dav/files/dwicki/Projekte/Abnahme%20%C3%84.bcfzip</d:href>
  <d:propstat><d:prop><d:resourcetype/><d:getcontentlength>2048</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
</d:multistatus>`;

const nc: NextcloudAccount = {
  id: 'nc1',
  provider: 'nextcloud',
  label: 'Test',
  baseUrl: 'https://cloud.example.ch/nc',
  loginName: 'dwicki',
  userId: 'dwicki',
  appPassword: 'secret',
  createdAt: '',
};

describe('Nextcloud', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('normalizes server URLs', () => {
    expect(normalizeNextcloudUrl('cloud.example.ch')).toBe('https://cloud.example.ch');
    expect(normalizeNextcloudUrl('https://cloud.example.ch/nc/index.php/apps/files/?dir=/')).toBe('https://cloud.example.ch/nc');
    expect(normalizeNextcloudUrl('https://cloud.example.ch/remote.php/dav/files/x/')).toBe('https://cloud.example.ch');
  });

  it('parses a PROPFIND listing and skips the folder itself', () => {
    const e = parsePropfind(PROPFIND, 'dwicki', '/Projekte');
    expect(e).toEqual([
      { ref: '/Projekte/MFH Seefeld', name: 'MFH Seefeld', isDir: true, size: undefined, modified: '2026-11-04T10:00:00.000Z' },
      { ref: '/Projekte/Abnahme Ä.bcfzip', name: 'Abnahme Ä.bcfzip', isDir: false, size: 2048, modified: undefined },
    ]);
  });

  it('connects via OCS and lists via PROPFIND with Basic auth', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/ocs/v2.php/cloud/user')) {
        return new Response(JSON.stringify({ ocs: { data: { id: 'dwicki', displayname: 'Domi' } } }), { status: 200 });
      }
      expect(init?.method).toBe('PROPFIND');
      return new Response(PROPFIND, { status: 207 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const acc = await connectNextcloud({ url: 'cloud.example.ch/nc/', loginName: 'dwicki', appPassword: 'secret' });
    expect(acc.userId).toBe('dwicki');
    expect(acc.label).toBe('Domi · cloud.example.ch');
    const auth = (fetchMock.mock.calls[0][1]!.headers as Record<string, string>).Authorization;
    expect(atob(auth.replace('Basic ', ''))).toBe('dwicki:secret');

    const list = await listFolder(acc, '/Projekte');
    expect(fetchMock.mock.calls[1][0]).toBe('https://cloud.example.ch/nc/remote.php/dav/files/dwicki/Projekte/');
    expect(list.map((e) => e.name)).toEqual(['MFH Seefeld', 'Abnahme Ä.bcfzip']);
  });

  it('rejects wrong credentials with a readable message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
    await expect(connectNextcloud({ url: 'cloud.example.ch', loginName: 'x', appPassword: 'y' })).rejects.toThrow('App-Passwort ist falsch');
  });

  it('downloads a file with its original name', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('PK..', { status: 200 })));
    const f = await downloadEntry(nc, { ref: '/Projekte/a b.ifc', name: 'a b.ifc', isDir: false });
    expect(f.name).toBe('a b.ifc');
    expect(await f.text()).toBe('PK..');
  });
});

describe('OneDrive', () => {
  beforeEach(async () => {
    await db.kv.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  const od: OneDriveAccount = {
    id: 'od1',
    provider: 'onedrive',
    label: 'Domi',
    clientId: 'cid',
    tenant: 'schaerholzbau.ch',
    tokens: { accessToken: 'old', refreshToken: 'ref', expiresAt: Date.now() + 3600_000 },
    createdAt: '',
  };

  it('maps own and shared drive items', () => {
    expect(mapDriveItem({ id: 'i1', name: 'Pläne', folder: {}, parentReference: { driveId: 'b!abc' } })).toEqual({
      ref: 'b!abc|i1',
      name: 'Pläne',
      isDir: true,
      size: undefined,
      modified: undefined,
    });
    expect(
      mapDriveItem({ id: 'local', name: 'M.ifc', remoteItem: { id: 'r!5', file: {}, size: 10, parentReference: { driveId: 'd2' } } }),
    ).toMatchObject({ ref: 'd2|r!5', isDir: false, size: 10 });
    expect(mapDriveItem({ id: 'nb', name: 'Notizbuch', package: {}, parentReference: { driveId: 'd' } })).toBeUndefined();
  });

  it('lists folders, refreshes an expired token and follows paging', async () => {
    await saveAccount({ ...od, tokens: { ...od.tokens, expiresAt: 0 } });
    const acc = (await getAccounts())[0] as OneDriveAccount;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/oauth2/v2.0/token')) {
        expect(String(init?.body)).toContain('grant_type=refresh_token');
        return new Response(JSON.stringify({ access_token: 'new', refresh_token: 'ref2', expires_in: 3600 }), { status: 200 });
      }
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer new');
      if (url.includes('skiptoken')) {
        return new Response(JSON.stringify({ value: [{ id: 'f2', name: 'B.bcfzip', file: {}, size: 1, parentReference: { driveId: 'd' } }] }), { status: 200 });
      }
      expect(url).toBe('https://graph.microsoft.com/v1.0/drives/d/items/x!1/children?$top=200');
      return new Response(
        JSON.stringify({
          value: [{ id: 'f1', name: 'A.ifc', file: {}, size: 5, parentReference: { driveId: 'd' } }],
          '@odata.nextLink': 'https://graph.microsoft.com/v1.0/next?skiptoken=1',
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    expect((await listFolder(acc, '')).map((e) => e.name)).toEqual(['Für mich freigegeben', 'Meine Dateien']);
    const list = await listFolder(acc, 'd|x!1');
    expect(list.map((e) => e.name)).toEqual(['A.ifc', 'B.bcfzip']);
    const saved = (await getAccounts())[0] as OneDriveAccount;
    expect(saved.tokens.accessToken).toBe('new');
    expect(saved.tokens.refreshToken).toBe('ref2');
  });

  it('downloads through the pre-authenticated download URL', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('https://graph.microsoft.com')) {
        return new Response(JSON.stringify({ id: 'f1', name: 'A.ifc', '@microsoft.graph.downloadUrl': 'https://dl.example/abc' }), { status: 200 });
      }
      expect(url).toBe('https://dl.example/abc');
      return new Response('ISO-10303-21;', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const f = await downloadEntry(od, { ref: 'd|f1', name: 'A.ifc', isDir: false });
    expect(await f.text()).toBe('ISO-10303-21;');
  });
});
