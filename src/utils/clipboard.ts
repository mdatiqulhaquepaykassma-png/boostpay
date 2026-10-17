/**
 * Robust cross-platform clipboard copy utility
 * Handles modern browsers, iframe sandboxes, iOS Safari, and mobile WebViews.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  // Layer 1: Modern navigator.clipboard API
  if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // If blocked by iframe sandbox or permission policy, fall back to Layer 2
    }
  }

  // Layer 2: Dedicated textarea with document.execCommand('copy')
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.contain = 'strict';
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '-9999px';
    textarea.style.opacity = '0';
    textarea.style.fontSize = '16px'; // Prevents auto-zoom on iOS Safari
    
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);

    const successful = document.execCommand('copy');
    document.body.removeChild(textarea);
    if (successful) return true;
  } catch (err) {
    console.warn('Textarea clipboard copy fallback error:', err);
  }

  // Layer 3: Selection range fallback for restricted mobile environments
  try {
    const range = document.createRange();
    const span = document.createElement('span');
    span.textContent = text;
    span.style.all = 'unset';
    span.style.position = 'fixed';
    span.style.left = '-9999px';
    span.style.top = '-9999px';
    span.style.whiteSpace = 'pre';

    document.body.appendChild(span);
    range.selectNodeContents(span);
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
    const successful = document.execCommand('copy');
    document.body.removeChild(span);
    return successful;
  } catch (err) {
    console.error('All clipboard copy strategies failed:', err);
    return false;
  }
}
