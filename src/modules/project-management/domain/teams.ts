/**
 * Team isolation. A team is a project manager's whole reporting subtree.
 *
 * The team root is found by walking up the reporting line until the next manager up has
 * oversight (a Technical Head or Director), or there is no manager. With the org chart
 * Dilip (Technical Head) <- Parth <- Dhrupin <- Yogi, both Dhrupin and Yogi belong to
 * Parth's team. Based on the reporting line and permissions, never on titles or grades.
 */
export interface OrgPerson {
  id: string;
  managerId: string | null;
  hasOversight: boolean;
}

export { isExecutionStaff } from './availability';

export function teamRootOf(userId: string, people: OrgPerson[]): string {
  const byId = new Map(people.map((p) => [p.id, p]));
  const seen = new Set<string>();
  let current = userId;
  while (!seen.has(current)) {
    seen.add(current);
    const managerId = byId.get(current)?.managerId;
    if (!managerId) return current;
    const manager = byId.get(managerId);
    if (!manager || manager.hasOversight) return current;
    current = managerId;
  }
  return current; // reporting loop: treat the first repeated person as the root
}

/** Everyone in the same team as `userId`: the team root and all their direct/indirect reports. */
export function teamMemberIds(userId: string, people: OrgPerson[]): Set<string> {
  const root = teamRootOf(userId, people);
  const reportsByManager = new Map<string, string[]>();
  for (const person of people) {
    if (!person.managerId) continue;
    const list = reportsByManager.get(person.managerId) ?? [];
    list.push(person.id);
    reportsByManager.set(person.managerId, list);
  }
  const members = new Set<string>([root]);
  const queue = [root];
  while (queue.length) {
    for (const report of reportsByManager.get(queue.shift()!) ?? []) {
      if (members.has(report)) continue;
      members.add(report);
      queue.push(report);
    }
  }
  return members;
}

export interface SquadGroup<T> {
  leadId: string;
  leadName: string;
  isOwnSquad: boolean;
  label: string;
  members: T[];
}

export function groupEngineersBySquad<T extends { id: string; fullName: string }>(
  engineers: T[],
  people: OrgPerson[],
  currentUserId: string,
  hasOversight: boolean,
  leadNameMap?: Map<string, string>,
): SquadGroup<T>[] {
  const currentSquadLeadId = teamRootOf(currentUserId, people);
  const byLead = new Map<string, T[]>();

  for (const eng of engineers) {
    const leadId = teamRootOf(eng.id, people);
    const list = byLead.get(leadId) ?? [];
    list.push(eng);
    byLead.set(leadId, list);
  }

  const groups: SquadGroup<T>[] = [];
  for (const [leadId, members] of byLead.entries()) {
    const isOwn = leadId === currentSquadLeadId;
    const rawLeadName = leadNameMap?.get(leadId) ?? 'Squad Lead';
    const label = hasOversight || isOwn ? rawLeadName : `${rawLeadName} (needs approval)`;
    groups.push({
      leadId,
      leadName: rawLeadName,
      isOwnSquad: isOwn,
      label,
      members: [...members].sort((a, b) => a.fullName.localeCompare(b.fullName)),
    });
  }

  return groups.sort((a, b) => {
    if (a.isOwnSquad && !b.isOwnSquad) return -1;
    if (!a.isOwnSquad && b.isOwnSquad) return 1;
    return a.leadName.localeCompare(b.leadName);
  });
}
