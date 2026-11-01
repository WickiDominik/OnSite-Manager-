// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, setSetting } from '../db';
import { runSync } from '../sync';

const BASE = 'https://playground.bimcollab.com/bcf/3.0';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('runSync', () => {
  beforeEach(async () => {
    await Promise.all([db.projects.clear(), db.issues.clear(), db.photos.clear(), db.kv.clear()]);
    await setSetting('bimcollab.tokens', { accessToken: 'tok', refreshToken: 'ref', expiresAt: Date.now() + 3600_000 });
  });

  it('uploads Prüfberichte, skips local issues and pulls projects/topics', async () => {
    const ts = '2026-11-01T10:00:00Z';
    await db.projects.bulkAdd([
      { id: 'p1', name: 'Linked', location: '', status: 'active', bcfProjectId: 'bp1', createdAt: ts, updatedAt: ts },
      { id: 'p2', name: 'Local', location: '', status: 'active', createdAt: ts, updatedAt: ts },
    ]);
    const base = { description: '', location: '', priority: 'high' as const, createdAt: ts, updatedAt: ts };
    await db.issues.bulkAdd([
      { ...base, id: 'i1', projectId: 'p1', title: 'Linked issue', status: 'done', remark: 'erledigt', bcfGuid: 't1', synced: false },
      { ...base, id: 'i2', projectId: 'p2', title: 'Local issue', status: 'open', remark: 'x', synced: false },
    ]);
    await db.photos.add({ id: 'ph1', issueId: 'i1', dataUrl: 'data:image/jpeg;base64,AAAA', synced: false, createdAt: ts });

    const calls: { method: string; url: string; body?: any }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push({ method, url, body: init?.body ? JSON.parse(init.body as string) : undefined });
        const path = url.replace(BASE, '');
        if (method === 'POST' && path.endsWith('/viewpoints')) return json({ guid: 'vp-new' }, 201);
        if (method === 'POST' && path.endsWith('/comments')) return json({ guid: 'c-new' }, 201);
        if (method === 'PUT') return json({ guid: 't1' });
        if (path === '/projects/bp1/extensions') return json({ topic_status: ['Active', 'Resolved', 'Closed'] });
        if (path === '/projects/bp1/topics/t1') return json({ guid: 't1', title: 'Linked issue', topic_type: 'Issue', topic_status: 'Active', priority: 'High' });
        if (path === '/projects') return json([{ project_id: 'bp1', name: 'Linked (Server)' }, { project_id: 'bp2', name: 'Neu' }]);
        if (path === '/projects/bp1/topics')
          return json([
            { guid: 't1', title: 'Linked issue', topic_status: 'Resolved', priority: 'High', modified_date: '2099-01-01' },
            { guid: 't2', title: 'Server topic', topic_status: 'Active', priority: 'Critical', labels: ['EG'] },
          ]);
        if (path === '/projects/bp2/topics') return json([]);
        if (path.endsWith('/viewpoints'))
          return json([
            {
              guid: 'v',
              perspective_camera: {
                camera_view_point: { x: 1, y: 2, z: 3 },
                camera_direction: { x: 0, y: 1, z: 0 },
                camera_up_vector: { x: 0, y: 0, z: 1 },
                field_of_view: 60,
              },
            },
          ]);
        if (path.endsWith('/comments')) return json([{ guid: 'c', date: ts, author: 'a', comment: 'Hallo' }]);
        return json({ message: 'not found ' + path }, 404);
      }),
    );

    const progress: string[] = [];
    const result = await runSync((p) => progress.push(p.phase));

    expect(result.errors).toEqual([]);
    expect(result.reportsUploaded).toBe(1);
    expect(result.skippedLocal).toBe(1);
    expect(result.projects).toBe(2);
    expect(result.topicsFetched).toBe(2);
    expect(progress.at(-1)).toBe('done');

    const posts = calls.filter((c) => c.method !== 'GET');
    expect(posts.map((c) => `${c.method} ${c.url.replace(BASE, '')}`)).toEqual([
      'POST /projects/bp1/topics/t1/viewpoints',
      'POST /projects/bp1/topics/t1/comments',
      'PUT /projects/bp1/topics/t1',
    ]);
    expect(posts[0].body.snapshot).toEqual({ snapshot_type: 'jpg', snapshot_data: 'AAAA' });
    expect(posts[1].body).toEqual({ comment: 'erledigt', viewpoint_guid: 'vp-new' });
    expect(posts[2].body.topic_status).toBe('Resolved');

    const i1 = await db.issues.get('i1');
    expect(i1).toMatchObject({ synced: true, status: 'done', syncedRemark: 'erledigt' });
    expect(i1?.camera?.viewPoint).toEqual({ x: 1, y: 2, z: 3 });
    expect((await db.issues.get('i2'))).toMatchObject({ synced: true, localOnly: true });
    expect((await db.photos.get('ph1'))?.synced).toBe(true);
    const t2 = await db.issues.where('bcfGuid').equals('t2').first();
    expect(t2).toMatchObject({ projectId: 'p1', priority: 'critical', status: 'open', location: 'EG', synced: true });
    expect(await db.projects.where('bcfProjectId').equals('bp2').count()).toBe(1);
    expect((await db.projects.get('p1'))?.name).toBe('Linked (Server)');

    // second sync must not post the same remark again
    calls.length = 0;
    await db.issues.update('i1', { synced: false, status: 'in_progress' });
    await runSync(() => {});
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/comments'))).toBe(false);
  });
});
