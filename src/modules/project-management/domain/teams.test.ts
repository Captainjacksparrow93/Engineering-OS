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

  it('treats a pool member as root of their own team, even if reporting to another manager', () => {
    const peopleWithPool: OrgPerson[] = [
      { id: 'satish', managerId: null, hasOversight: true },
      { id: 'dilip', managerId: 'satish', hasOversight: true },
      { id: 'parth', managerId: 'dilip', hasOversight: false, isPoolMember: true },
      { id: 'dhrupin', managerId: 'parth', hasOversight: false, isPoolMember: true },
      { id: 'yogi', managerId: 'dhrupin', hasOversight: false },
      { id: 'paras', managerId: 'dilip', hasOversight: false, isPoolMember: true },
      { id: 'harsh', managerId: 'paras', hasOversight: false },
    ];

    expect(teamRootOf('dhrupin', peopleWithPool)).toBe('dhrupin');
    expect(teamRootOf('yogi', peopleWithPool)).toBe('dhrupin');
    expect(teamRootOf('dhrupin', peopleWithPool)).toBe(teamRootOf('yogi', peopleWithPool));
    expect(teamRootOf('dhrupin', peopleWithPool)).not.toBe(teamRootOf('harsh', peopleWithPool));
    expect(teamRootOf('dhrupin', peopleWithPool)).not.toBe(teamRootOf('paras', peopleWithPool));
  });

  it('stops at pool members in teamMemberIds so an engineer squad never leaks into a parent PM squad', () => {
    const peopleWithPool: OrgPerson[] = [
      { id: 'satish', managerId: null, hasOversight: true },
      { id: 'dilip', managerId: 'satish', hasOversight: true },
      { id: 'parth', managerId: 'dilip', hasOversight: false, isPoolMember: true },
      { id: 'shivam', managerId: 'parth', hasOversight: false },
      { id: 'dhrupin', managerId: 'parth', hasOversight: false, isPoolMember: true },
      { id: 'yogi', managerId: 'dhrupin', hasOversight: false },
      { id: 'paras', managerId: 'dilip', hasOversight: false, isPoolMember: true },
      { id: 'harsh', managerId: 'paras', hasOversight: false },
    ];

    // Parth's team members should include shivam, but stop at dhrupin (and thus exclude yogi)
    const parthTeam = teamMemberIds('parth', peopleWithPool);
    expect(parthTeam.has('parth')).toBe(true);
    expect(parthTeam.has('shivam')).toBe(true);
    expect(parthTeam.has('dhrupin')).toBe(false);
    expect(parthTeam.has('yogi')).toBe(false);

    // Yogi / Dhrupin team should be dhrupin and yogi only, excluding parth
    const yogiTeam = teamMemberIds('yogi', peopleWithPool);
    expect(yogiTeam.has('dhrupin')).toBe(true);
    expect(yogiTeam.has('yogi')).toBe(true);
    expect(yogiTeam.has('parth')).toBe(false);
    expect(yogiTeam.has('shivam')).toBe(false);
  });

  it('formats group lead names with formatName and includes pool members in their own group', () => {
    const peopleWithPool: OrgPerson[] = [
      { id: 'dilip', managerId: null, hasOversight: true },
      { id: 'munaf', managerId: 'dilip', hasOversight: false, isPoolMember: true },
      { id: 'het', managerId: 'munaf', hasOversight: false },
      { id: 'parth', managerId: 'dilip', hasOversight: false, isPoolMember: true },
    ];

    const assignable = [
      { id: 'munaf', fullName: 'Munaf Anavarbhai Multani' },
      { id: 'het', fullName: 'Het Patel' },
      { id: 'parth', fullName: 'Parth Dasharathbhai Nagar' },
    ];

    const leadNames = new Map([
      ['munaf', 'Munaf Anavarbhai Multani'],
      ['parth', 'Parth Dasharathbhai Nagar'],
    ]);

    const groups = groupEngineersBySquad(assignable, peopleWithPool, 'munaf', false, leadNames);

    // Formatted name used for leadName and label (no raw 3-part names)
    expect(groups[0].leadId).toBe('munaf');
    expect(groups[0].leadName).toBe('Munaf Multani');
    expect(groups[0].label).toBe('Munaf Multani');
    expect(groups[0].isOwnSquad).toBe(true);

    // Other squad has formatted name + (needs approval)
    expect(groups[1].leadId).toBe('parth');
    expect(groups[1].leadName).toBe('Parth Nagar');
    expect(groups[1].label).toBe('Parth Nagar (needs approval)');

    // Pool member Munaf appears inside his own squad members
    const munafSquad = groups.find((g) => g.leadId === 'munaf');
    expect(munafSquad?.members.some((m) => m.id === 'munaf')).toBe(true);
    expect(munafSquad?.members.some((m) => m.id === 'het')).toBe(true);

    // Parth appears in his squad members
    const parthSquad = groups.find((g) => g.leadId === 'parth');
    expect(parthSquad?.members.some((m) => m.id === 'parth')).toBe(true);
  });
});
