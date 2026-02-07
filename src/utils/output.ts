import chalk from 'chalk';

/**
 * Terminal output utilities with width awareness and JSON formatting
 */
export interface OutputFormatter {
  isJson: boolean;
  indent: number;
}

let globalFormatter: OutputFormatter = { isJson: false, indent: 2 };

/**
 * Set global output format
 */
export function setOutputFormat(format: 'json' | 'pretty' = 'pretty', indent = 2): void {
  globalFormatter = { isJson: format === 'json', indent };
}

/**
 * Get current output format
 */
export function getOutputFormat(): OutputFormatter {
  return globalFormatter;
}

export { globalFormatter };
export default { setOutputFormat, getOutputFormat, printData, formatTable, truncateText, printError, printSuccess, printWarning, printInfo };

/**
 * Print data based on current format
 */
export function printData(data: unknown): void {
  if (globalFormatter.isJson) {
    console.log(JSON.stringify(data, null, globalFormatter.indent));
  } else {
    console.log(data);
  }
}

/**
 * Format a table for terminal output
 */
export function formatTable(
  headers: string[],
  rows: (string | number | boolean | undefined)[][]
): string {
  if (globalFormatter.isJson) {
    return JSON.stringify({ headers, rows }, null, globalFormatter.indent);
  }

  // Calculate column widths
  const widths = headers.map((h, i) => {
    const headerLen = String(h).length;
    const maxDataLen = Math.max(...rows.map(r => String(r[i] ?? '').length));
    return Math.max(headerLen, maxDataLen);
  });

  // Build table
  const lines: string[] = [];
  
  // Header
  const headerRow = headers.map((h, i) => String(h).padEnd(widths[i])).join(' │ ');
  lines.push(headerRow);
  lines.push(widths.map(w => '─'.repeat(w)).join('─┼─'));
  
  // Rows
  for (const row of rows) {
    const dataRow = row.map((cell, i) => String(cell ?? '').padEnd(widths[i])).join(' │ ');
    lines.push(dataRow);
  }
  
  return lines.join('\n');
}

/**
 * Truncate text to fit terminal width
 */
export function truncateText(text: string, maxWidth?: number): string {
  const width = maxWidth || process.stdout.columns || 80;
  if (text.length <= width) return text;
  return text.slice(0, width - 3) + '...';
}

/**
 * Print error with actionable hint
 */
export function printError(message: string, hint?: string): void {
  console.error(chalk.red(`✗ ${message}`));
  if (hint) {
    console.error(chalk.gray(`  ${hint}`));
  }
}

/**
 * Print success message
 */
export function printSuccess(message: string): void {
  console.log(chalk.green(`✓ ${message}`));
}

/**
 * Print warning with suggestion
 */
export function printWarning(message: string, suggestion?: string): void {
  console.log(chalk.yellow(`⚠ ${message}`));
  if (suggestion) {
    console.log(chalk.gray(`  ${suggestion}`));
  }
}

/**
 * Print info message
 */
export function printInfo(message: string): void {
  console.log(chalk.gray(`ℹ ${message}`));
}
