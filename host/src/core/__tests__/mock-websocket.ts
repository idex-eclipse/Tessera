import type { WebSocketLike } from '../moonraker-proxy';

export const WS_CONNECTING = 0;
export const WS_OPEN = 1;
export const WS_CLOSING = 2;
export const WS_CLOSED = 3;

/**
 * Test-only WebSocket implementation.
 *
 * It is intentionally synchronous and controllable:
 * - simulateOpen()
 * - simulateMessage()
 * - simulateClose()
 */
export class MockWebSocket implements WebSocketLike {
  static instances: MockWebSocket[] = [];

  static reset(): void {
    MockWebSocket.instances = [];
  }

  readonly url: string;

  readyState: number = WS_CONNECTING;

  onopen: ((event?: unknown) => void) | null = null;
  onclose: ((event?: unknown) => void) | null = null;
  onerror: ((event?: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;

  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    if (this.readyState !== WS_OPEN) {
      throw new Error('MockWebSocket is not open');
    }

    this.sent.push(data);
  }

  close(_code?: number, _reason?: string): void {
    if (this.readyState === WS_CLOSED || this.readyState === WS_CLOSING) {
      return;
    }

    this.readyState = WS_CLOSING;
    this.onclose?.({ code: 1000, reason: 'mock close' });
    this.readyState = WS_CLOSED;
  }

  simulateOpen(): void {
    if (this.readyState !== WS_CONNECTING) {
      return;
    }

    this.readyState = WS_OPEN;
    this.onopen?.({});
  }

  simulateMessage(message: unknown): void {
    if (this.readyState !== WS_OPEN) {
      return;
    }

    const data =
      typeof message === 'string'
        ? message
        : (JSON.stringify(message) ?? 'null');

    this.onmessage?.({ data });
  }

  simulateClose(code = 1006, reason = 'mock abnormal closure'): void {
    if (this.readyState === WS_CLOSED) {
      return;
    }

    this.readyState = WS_CLOSED;
    this.onclose?.({ code, reason });
  }

  get sentMessages(): Array<Record<string, unknown>> {
    return this.sent.map((item) => JSON.parse(item) as Record<string, unknown>);
  }

  sentMethods(): string[] {
    return this.sentMessages
      .map((message) => message.method)
      .filter((method): method is string => typeof method === 'string');
  }

  lastSentMessage(): Record<string, unknown> | undefined {
    const messages = this.sentMessages;
    return messages[messages.length - 1];
  }

  respond(id: number, result: unknown): void {
    this.simulateMessage({
      jsonrpc: '2.0',
      id,
      result,
    });
  }

  respondError(
    id: number,
    message: string,
    code?: number,
    data?: unknown,
  ): void {
    this.simulateMessage({
      jsonrpc: '2.0',
      id,
      error: {
        message,
        code,
        data,
      },
    });
  }

  notify(method: string, params?: unknown): void {
    this.simulateMessage({
      jsonrpc: '2.0',
      method,
      params,
    });
  }
}