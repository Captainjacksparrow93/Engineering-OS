export interface TestPersona {
  id: string;
  name: string;
  email: string;
  roleLabel: string;
  shortRole: string;
  tag: string;
  color: string;
  badgeClass: string;
}

export const TEST_PERSONAS: TestPersona[] = [
  {
    id: 'director',
    name: 'Satish Nagar',
    email: 'admin@acsengitech.com',
    roleLabel: 'Director',
    shortRole: 'Director',
    tag: '👔 Director',
    color: '#b45309',
    badgeClass: 'bg-amber-100 text-amber-900 border-amber-300',
  },
  {
    id: 'head',
    name: 'Dilip Asediya',
    email: 'dilipkumar.asediya@acsengitech.com',
    roleLabel: 'Head of Technical (Dept Head)',
    shortRole: 'Dept Head',
    tag: '🏢 Dept Head',
    color: '#1d4ed8',
    badgeClass: 'bg-blue-100 text-blue-900 border-blue-300',
  },
  {
    id: 'pm1',
    name: 'Parth Nagar',
    email: 'parth.nagar@acsengitech.com',
    roleLabel: 'Project Manager (Team 1)',
    shortRole: 'PM 1',
    tag: '📋 PM 1',
    color: '#047857',
    badgeClass: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  },
  {
    id: 'pm2',
    name: 'Paras Prajapati',
    email: 'paras.prajapati@acsengitech.com',
    roleLabel: 'Project Manager (Team 2)',
    shortRole: 'PM 2',
    tag: '📋 PM 2',
    color: '#0f766e',
    badgeClass: 'bg-teal-100 text-teal-900 border-teal-300',
  },
  {
    id: 'engineer',
    name: 'Shivam Prajapati',
    email: 'shivam.prajapati@acsengitech.com',
    roleLabel: 'Sr. Engineer (Parth Team)',
    shortRole: 'Sr. Engineer',
    tag: '⚡ Engineer',
    color: '#6d28d9',
    badgeClass: 'bg-purple-100 text-purple-900 border-purple-300',
  },
];
