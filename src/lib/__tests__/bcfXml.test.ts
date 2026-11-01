// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { buildMarkup, buildViewpoint, parseMarkup, parseViewpointCamera } from '../bcfXml';

describe('BCF XML', () => {
  it('round-trips markup with comments and viewpoints', () => {
    const xml = buildMarkup({
      guid: 'g-1',
      title: 'Riss <Wand> & Decke',
      description: 'Beschreibung',
      status: 'Open',
      priority: 'High',
      type: 'Issue',
      creationDate: '2026-11-01T10:00:00Z',
      modifiedDate: '2026-11-01T11:00:00Z',
      author: 'domi',
      labels: ['2. OG'],
      comments: [{ guid: 'c-1', date: '2026-11-01T11:00:00Z', author: 'domi', text: 'Bemerkung', viewpointGuid: 'v-1' }],
      viewpoints: [{ guid: 'v-1', viewpoint: 'viewpoint.bcfv', snapshot: 'snapshot.jpg' }],
    });
    const t = parseMarkup(xml, 'folder');
    expect(t.guid).toBe('g-1');
    expect(t.title).toBe('Riss <Wand> & Decke');
    expect(t.status).toBe('Open');
    expect(t.priority).toBe('High');
    expect(t.labels).toEqual(['2. OG']);
    expect(t.comments).toHaveLength(1);
    expect(t.comments[0].text).toBe('Bemerkung');
    expect(t.viewpoints[0]).toMatchObject({ guid: 'v-1', viewpoint: 'viewpoint.bcfv', snapshot: 'snapshot.jpg' });
  });

  it('round-trips a perspective camera', () => {
    const cam = { viewPoint: { x: 1, y: 2, z: 3 }, direction: { x: 0, y: 1, z: 0 }, upVector: { x: 0, y: 0, z: 1 }, fieldOfView: 55 };
    expect(parseViewpointCamera(buildViewpoint('v', cam))).toEqual(cam);
    expect(parseViewpointCamera(buildViewpoint('v'))).toBeUndefined();
  });
});
