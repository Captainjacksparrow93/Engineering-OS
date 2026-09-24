import { describe, expect, it } from 'vitest';
import { groupEngineersBySquad, teamMemberIds, teamRootOf, type OrgPerson } from './teams';

// Satish (Director) <- Dilip (Technical Head) <- Parth <- Shivam, Dhrupin <- Yogi <- Anurag
//                                              <- Paras <- Harsh, Chirag <- Harmitsinh
const people: OrgPerson[] = [
  { id: 'satish', managerId: null, hasOversight: true },
  { id: 'dilip', managerId: 'satish', hasOversight: true },
  { id: 'parth', managerId: 'dilip', hasOversight: false },
  { id: 'shivam', managerId: 'parth', hasOversight: false },
  { id: 'dhrupin', managerId: 'parth', hasOversight: false },
  { id: 'yogi', managerId: 'dhrupin', hasOversight: false },
  { id: 'anurag', managerId: 'yogi', hasOversight: false },
  { id: 'paras', managerId: 'dilip', hasOversight: false },
  { id: 'harsh', managerId: 'paras', hasOversight: false },
  { id: 'chirag', managerId: 'paras', hasOversight: false },
  { id: 'harmitsinh', managerId: 'chirag', hasOversight: false },
];

describe('team isolation', () => {
  it('finds the PM under the Technical Head as the team root at any depth', () => {
    expect(teamRootOf('parth', people)).toBe('parth');
    expect(teamRootOf('yogi', people)).toBe('parth');
    expect(teamRootOf('anurag', people)).toBe('parth');
    expect(teamRootOf('harmitsinh', people)).toBe('paras');
  });

  it("gives an engineer exactly their PM's whole team", () => {
    const parthTeam = [...teamMemberIds('yogi', people)].sort();
    expect(parthTeam).toEqual(['anurag', 'dhrupin', 'parth', 'shivam', 'yogi']);
    const parasTeam = teamMemberIds('harsh', people);
    expect(parasTeam.has('harmitsinh')).toBe(true);
    expect(parasTeam.has('shivam')).toBe(false);
  });

  it('survives a reporting loop', () => {
    const loop: OrgPerson[] = [
      { id: 'a', managerId: 'b', hasOversight: false },
      { id: 'b', managerId: 'a', hasOversight: false },
    ];
    expect(teamMemberIds('a', loop)).toEqual(new Set(['a', 'b']));
  });

  it('groups engineers by squad with own squad first and approval suffix', () => {
    const seededPeople: OrgPerson[] = [
      { id: 'dilip', managerId: null, hasOversight: true },
      { id: 'parth', managerId: 'dilip', hasOversight: false },
      { id: 'paras', managerId: 'dilip', hasOversight: false },
      { id: 'munaf', managerId: 'dilip', hasOversight: false },
      { id: 'dhrupin', managerId: 'dilip', hasOversight: false },
      { id: 'shivam', managerId: 'parth', hasOversight: false },
      { id: 'harsh', managerId: 'paras', hasOversight: false },
      { id: 'het', managerId: 'munaf', hasOversight: false },
      { id: 'yogi', managerId: 'dhrupin', hasOversight: false },
    ];

    const engineers = [
      { id: 'shivam', fullName: 'Shivam Prajapati' },
      { id: 'harsh', fullName: 'Harsh Suthar' },
      { id: 'het', fullName: 'Het Patel' },
      { id: 'yogi', fullName: 'Yogi Joshi' },
    ];

    const leadNames = new Map([
      ['parth', 'Parth Nagar'],
      ['paras', 'Paras Prajapati'],
      ['munaf', 'Munaf Multani'],
      ['dhrupin', 'Dhrupin Vaghasiya'],
    ]);

    // For Parth (PM): own squad first, others have (needs approval)
    const parthGroups = groupEngineersBySquad(engineers, seededPeople, 'parth', false, leadNames);
    expect(parthGroups[0].leadId).toBe('parth');
    expect(parthGroups[0].label).toBe('Parth Nagar');
    expect(parthGroups[0].isOwnSquad).toBe(true);
    expect(parthGroups.slice(1).every((g) => g.label.endsWith('(needs approval)'))).toBe(true);

    // For Dilip / Director (hasOversight: true): no (needs approval) suffix anywhere
    const oversightGroups = groupEngineersBySquad(engineers, seededPeople, 'dilip', true, leadNames);
    expect(oversightGroups.every((g) => !g.label.includes('(needs approval)'))).toBe(true);
  });
});
