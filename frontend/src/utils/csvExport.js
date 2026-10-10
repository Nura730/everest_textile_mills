/**
 * Utility to export tabular data to a downloadable CSV file.
 * Automatically formats headers, handles commas and quotes, and triggers browser download.
 */
export function exportToCSV(filename, rows, headers) {
  if (!rows || rows.length === 0) {
    return false;
  }

  // Extract column keys and header titles
  const keys = headers ? headers.map((h) => h.key) : Object.keys(rows[0]);
  const headerTitles = headers ? headers.map((h) => h.label || h.key) : keys;

  const escapeCSV = (val) => {
    if (val === null || val === undefined) return '';
    let str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      str = `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const csvRows = [
    headerTitles.map(escapeCSV).join(','),
    ...rows.map((row) => keys.map((key) => escapeCSV(row[key])).join(',')),
  ];

  const csvContent = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvRows.join('\n'));
  const link = document.createElement('a');
  link.setAttribute('href', csvContent);
  link.setAttribute('download', `${filename.replace(/\.csv$/i, '')}_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  return true;
}
