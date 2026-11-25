/** Normalize a printer address for Moonraker's HTTP and WebSocket endpoints. */
export function normalizePrinterUrl(input: string): string | null {
  const address = input.trim();
  if (!address) return null;

  // A scheme-free address targets Moonraker's direct port; explicit URLs keep their port.
  const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(address);
  if (!hasScheme && address.includes('://')) return null;

  try {
    const url = new URL(hasScheme ? address : `http://${address}`);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) return null;

    if (!hasScheme && !url.port) url.port = '7125';
    return url.origin;
  } catch {
    return null;
  }
}
