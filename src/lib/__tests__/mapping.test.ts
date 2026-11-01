import { describe, expect, it } from 'vitest';
import { bcfPriorityToLocal, bcfStatusToLocal, localPriorityToBcf, localStatusToBcf } from '../mapping';

describe('status mapping', () => {
  it('maps BimCollab statuses', () => {
    expect(bcfStatusToLocal('Active')).toBe('open');
    expect(bcfStatusToLocal('Open')).toBe('open');
    expect(bcfStatusToLocal('InProgress')).toBe('in_progress');
    expect(bcfStatusToLocal('Resolved')).toBe('done');
    expect(bcfStatusToLocal('Closed')).toBe('done');
    expect(bcfStatusToLocal(undefined)).toBe('open');
  });

  it('prefers server-side status values', () => {
    const allowed = ['Active', 'Resolved', 'Closed'];
    expect(localStatusToBcf('done', allowed)).toBe('Resolved');
    expect(localStatusToBcf('open', allowed)).toBe('Active');
    expect(localStatusToBcf('in_progress', allowed)).toBe('Active');
    expect(localStatusToBcf('done', allowed, 'Closed')).toBe('Closed');
    expect(localStatusToBcf('in_progress')).toBe('InProgress');
  });

  it('maps priorities both ways', () => {
    expect(bcfPriorityToLocal('Critical')).toBe('critical');
    expect(bcfPriorityToLocal('High')).toBe('high');
    expect(bcfPriorityToLocal('Normal')).toBe('medium');
    expect(bcfPriorityToLocal('Low')).toBe('low');
    expect(localPriorityToBcf('medium', ['Low', 'Normal', 'High'])).toBe('Normal');
    expect(localPriorityToBcf('critical')).toBe('Critical');
  });
});
