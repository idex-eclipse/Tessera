/**
 * Копирование в буфер обмена. navigator.clipboard доступен только в secure context
 * (https / localhost), а принтеры в LAN обычно открывают по http — поэтому есть
 * запасной путь через временный textarea и execCommand('copy').
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // нет разрешения / фокуса — пробуем запасной путь
  }

  if (typeof document === 'undefined') return false;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  document.body.appendChild(ta);
  try {
    ta.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    ta.remove();
  }
}
