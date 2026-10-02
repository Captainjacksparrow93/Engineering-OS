import { describe, it, expect } from 'vitest';
import { projectLabel } from './project-label';

describe('projectLabel (#11 & #7)', () => {
  it('formats project with WO number and client name', () => {
    expect(
      projectLabel({ workOrderNo: '6934', clientName: 'Reliance Industries' })
    ).toBe('WO 6934 · Reliance Industries');
  });

  it('formats project with name when workOrderNo is not provided', () => {
    expect(
      projectLabel({ name: 'WO 7120', clientName: 'Adani Power' })
    ).toBe('WO 7120 · Adani Power');
  });

  it('supports custom separator like em-dash', () => {
    expect(
      projectLabel({ workOrderNo: '7120', clientName: 'Tata Steel' }, '—')
    ).toBe('WO 7120 — Tata Steel');
  });

  it('formats service call without WO number', () => {
    expect(
      projectLabel({ kind: 'SERVICE_CALL', clientName: 'JSW Energy' })
    ).toBe('SERVICE CALL · JSW Energy');
  });

  it('avoids duplicating client name if already present in name', () => {
    expect(
      projectLabel({ name: 'WO 7000 · Torrent Pharma', clientName: 'Torrent Pharma' })
    ).toBe('WO 7000 · Torrent Pharma');
  });

  it('formats project code together with WO number and client', () => {
    expect(
      projectLabel({ code: 'ACS-0004-0001', workOrderNo: '6934', clientName: 'Reliance Industries' })
    ).toBe('ACS-0004-0001 · WO 6934 · Reliance Industries');
  });

  it('formats project code for service calls', () => {
    expect(
      projectLabel({ code: 'ACS-0004-0002', kind: 'SERVICE_CALL', clientName: 'Torrent Pharma' })
    ).toBe('ACS-0004-0002 · SERVICE CALL · Torrent Pharma');
  });
});
