export function formatName(name: string | null | undefined): string {
  if (!name) return '';
  if (name === 'Admin Controller' || name === 'Super Admin') return 'Satish Nagar';

  const cleanName = name
    .replace(/\s*-\s*Canteen/i, '')
    .replace(/Kichen Cleaning/i, '')
    .trim();

  const parts = cleanName.split(/\s+/);
  if (parts.length <= 1) return cleanName;

  let first = parts[0]!;
  if (first.toLowerCase().endsWith('kumar') && first.length > 5) {
    first = first.slice(0, -5);
  }

  if (parts.length === 2) return first + ' ' + parts[1];

  const last = parts[parts.length - 1]!;
  return first + ' ' + last;
}

