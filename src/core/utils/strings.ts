export function formatName(name: string | null | undefined): string {
  if (!name) return '';
  if (name === 'Admin Controller' || name === 'Super Admin') return 'Satish Nagar';
  
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return name.trim();
  
  let first = parts[0]!;
  if (first.toLowerCase().endsWith('kumar')) {
    first = first.slice(0, -5);
  }
  
  if (parts.length === 2) return first + ' ' + parts[1];
  
  const last = parts[parts.length - 1]!;
  return first + ' ' + last;
}
