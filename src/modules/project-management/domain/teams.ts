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
  isPoolMember?: boolean;
}

export { isExecutionStaff } from './availability';
import { formatName } from '@/core/utils/strings';

export function teamRootOf(userId: string, people: OrgPerson[]): string {
  const byId = new Map(people.map((p) => [p.id, p]));
  const seen = new Set<string>();
  let current = userId;

  // A pool member is always the root of their own team
  if (byId.get(current)?.isPoolMember) return current;

  while (!seen.has(current)) {
    seen.add(current);
    const managerId = byId.get(current)?.managerId;
    if (!managerId) return current;
    const manager = byId.get(managerId);
    if (!manager || manager.hasOversight) return current;
    if (manager.isPoolMember) return managerId;
    current = managerId;
  }
  return current; // reporting loop: treat the first repeated person as the root
}

/** Everyone in the same team as `userId`: the team root and all their direct/indirect reports. */
export function teamMemberIds(userId: string, people: OrgPerson[]): Set<string> {
  const byId = new Map(people.map((p) => [p.id, p]));
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
    const current = queue.shift()!;
    for (const reportId of reportsByManager.get(current) ?? []) {
      if (members.has(reportId)) continue;
      const report = byId.get(reportId);
      if (report?.hasOversight || report?.isPoolMember) continue;
      members.add(reportId);
      queue.push(reportId);
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
    const rawLeadName = leadNameMap?.get(leadId);
    const leadName = rawLeadName ? formatName(rawLeadName) : 'Squad Lead';
    const label = hasOversight || isOwn ? leadName : `${leadName} (needs approval)`;
    groups.push({
      leadId,
      leadName,
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
