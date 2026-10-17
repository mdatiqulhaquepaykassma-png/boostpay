/**
 * Currency & decimal precision formatting utilities for micro compounding
 */

/**
 * Formats a number to up to 8 decimal places, removing redundant trailing zeroes beyond 2 decimal places
 * e.g.:
 *  100 -> "100.00"
 *  100.5 -> "100.50"
 *  100.000001 -> "100.000001"
 *  0.00000125 -> "0.00000125"
 */
export function formatPrecisionAmount(value: number | string | undefined | null, maxDecimals: number = 8): string {
  const num = Number(value);
  if (isNaN(num)) return '0.00';
  
  // Format with full decimals first
  const fixedStr = num.toFixed(maxDecimals);
  const [intPart, decPart] = fixedStr.split('.');
  
  if (!decPart) return `${intPart}.00`;
  
  // Keep at least 2 decimal places, then trim trailing zeroes
  let trimmedDec = decPart.replace(/0+$/, '');
  if (trimmedDec.length < 2) {
    trimmedDec = decPart.slice(0, 2);
  }
  
  return `${intPart}.${trimmedDec}`;
}

/**
 * Strict 8-decimal formatter for wallet balances and live yield tickers
 */
export function formatStrict8Decimals(value: number | string | undefined | null): string {
  const num = Number(value);
  if (isNaN(num)) return '0.00000000';
  return num.toFixed(8);
}

/**
 * Formats rate percentage string to avoid scientific notation like 1e-6
 */
export function formatRatePercent(value: number | string | undefined | null): string {
  const num = Number(value);
  if (isNaN(num)) return '0';
  if (num === 0) return '0';
  
  // If number is formatted in scientific notation like 1e-6
  const str = num.toString();
  if (str.includes('e-') || str.includes('E-')) {
    return num.toFixed(8).replace(/0+$/, '');
  }
  return str;
}
