import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';
import type { ConnectionStatus } from '../shared/chat';
const input = z
  .object({
    model: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[a-zA-Z0-9._:\/-]+$/)
      .optional(),
    apiKey: z.string().trim().min(1).max(500).optional(),
    persist: z.boolean().optional(),
    disconnect: z.boolean().optional(),
  })
  .strict();
const encoder = new TextEncoder();
const b64 = (value: Uint8Array) => btoa(String.fromCharCode(...value));
const unb64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
export class ConnectionManager {
  private apiKey: string | undefined;
  private model = 'gpt-4.1-mini';
  private persisted = false;
  cookie: string | undefined;
  constructor(
    private secret: string,
    private user: string,
  ) {}
  private cryptoKey() {
    return crypto.subtle.importKey('raw', unb64(this.secret), { name: 'AES-GCM' }, false, [
      'encrypt',
      'decrypt',
    ]);
  }
  async restore(request: Request) {
    const value = request.headers
      .get('cookie')
      ?.split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith('__Host-research-openai='))
      ?.split('=')
      .slice(1)
      .join('=');
    if (!value || !this.secret) return;
    try {
      const [iv, data] = decodeURIComponent(value).split('.');
      const clear = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: unb64(iv), additionalData: encoder.encode(this.user) },
        await this.cryptoKey(),
        unb64(data),
      );
      const saved = JSON.parse(new TextDecoder().decode(clear));
      if (saved.expiresAt > Date.now()) {
        this.apiKey = saved.apiKey;
        this.model = saved.model;
        this.persisted = saved.persisted;
      }
    } catch {
      /* An invalid/expired cookie is disconnected; never expose its contents. */
    }
  }
  get() {
    return { apiKey: this.apiKey, model: this.model };
  }
  status(): ConnectionStatus {
    return {
      configured: !!this.apiKey,
      model: this.model,
      source: this.apiKey ? 'memory' : 'none',
      persisted: this.persisted,
    };
  }
  async update(raw: unknown) {
    const value = input.parse(raw);
    if (value.disconnect) {
      this.apiKey = undefined;
      this.persisted = false;
      this.cookie = '__Host-research-openai=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0';
      return this.status();
    }
    if (!this.secret)
      throw new Error(
        'The secure connection service is not configured. Your research remains available.',
      );
    if (value.model) this.model = value.model;
    if (value.apiKey) this.apiKey = value.apiKey;
    if (typeof value.persist === 'boolean') this.persisted = value.persist;
    if (!this.apiKey) throw new Error('Enter an OpenAI API key first');
    const age = this.persisted ? 30 * 86400 : 86400;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: encoder.encode(this.user) },
      await this.cryptoKey(),
      encoder.encode(
        JSON.stringify({
          apiKey: this.apiKey,
          model: this.model,
          persisted: this.persisted,
          expiresAt: Date.now() + age * 1000,
        }),
      ),
    );
    this.cookie = `__Host-research-openai=${encodeURIComponent(`${b64(iv)}.${b64(new Uint8Array(data))}`)}; Path=/; Secure; HttpOnly; SameSite=Strict${this.persisted ? `; Max-Age=${age}` : ''}`;
    return this.status();
  }
  async test(request: typeof fetch = fetch) {
    if (!this.apiKey) throw new Error('Connect an OpenAI API key first');
    let response: Response;
    try {
      response = await request(
        `https://api.openai.com/v1/models/${encodeURIComponent(this.model)}`,
        { headers: { Authorization: `Bearer ${this.apiKey}` }, signal: AbortSignal.timeout(15000) },
      );
    } catch {
      throw new Error('Could not reach OpenAI. Try again shortly.');
    }
    if (!response.ok)
      throw new Error(
        `OpenAI connection check failed (${response.status}). Check your API key and model access.`,
      );
    return {
      ok: true,
      model: this.model,
      message: 'Key and model access confirmed. No generation request was made.',
    };
  }
}
const connections = new AsyncLocalStorage<ConnectionManager>();
export function withConnection<T>(connection: ConnectionManager, action: () => T) {
  return connections.run(connection, action);
}
export function connectionManager() {
  const value = connections.getStore();
  if (!value) throw new Error('No active research connection');
  return value;
}
export function getConnection() {
  return connectionManager().get();
}
export function connectionStatus() {
  return connectionManager().status();
}
