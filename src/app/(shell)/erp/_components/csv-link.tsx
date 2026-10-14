/** "Download CSV" for an ERP list or report, carrying the screen's filters. */
export function CsvLink({ report, params = {} }: { report: string; params?: Record<string, string | undefined | null> }) {
  const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1])).toString();
  return <a href={`/api/erp/export/${report}${q ? `?${q}` : ''}`} className="btn btn-secondary btn-sm" download>Download CSV</a>;
}
