import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import type { ConnectionStatus } from '../shared/chat';

const modelSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9._:\/-]+$/);
const connectionInput = z
  .object({
    model: modelSchema.optional(),
    apiKey: z.string().trim().min(1).max(500).optional(),
    persist: z.boolean().optional(),
    disconnect: z.boolean().optional(),
  })
  .strict();

/** Credentials never enter SQLite, API response objects, logs, or the browser. */
export class ConnectionManager {
  private key: string | undefined;
  private model: string;
  private source: ConnectionStatus['source'];
  private disabled = false;
  private readonly filePath: string;
  constructor(options: { filePath?: string; environment?: NodeJS.ProcessEnv } = {}) {
    const environment = options.environment ?? process.env;
    this.filePath = options.filePath ?? resolve('data/openai-connection.json');
    this.key = environment.OPENAI_API_KEY;
    this.model = environment.OPENAI_MODEL || 'gpt-4.1-mini';
    this.source = this.key ? 'environment' : 'none';
    if (existsSync(this.filePath)) {
      try {
        const stored = connectionInput.parse(JSON.parse(readFileSync(this.filePath, 'utf8')));
        if (stored.apiKey) {
          this.key = stored.apiKey;
          this.model = stored.model || this.model;
          this.source = 'local-file';
          chmodSync(this.filePath, 0o600);
        }
      } catch {
        // A corrupt local configuration is not printed, and environment fallback remains usable.
      }
    }
  }
  get() {
    return { apiKey: this.disabled ? undefined : this.key, model: this.model };
  }
  status(): ConnectionStatus {
    return {
      configured: !!this.get().apiKey,
      model: this.model,
      source: this.disabled ? 'none' : this.source,
      persisted: this.source === 'local-file' && !this.disabled,
    };
  }
  update(raw: unknown): ConnectionStatus {
    const input = connectionInput.parse(raw);
    if (input.disconnect) {
      this.key = undefined;
      this.source = 'none';
      this.disabled = true;
      if (existsSync(this.filePath)) unlinkSync(this.filePath);
      return this.status();
    }
    if (input.model) this.model = input.model;
    if (input.apiKey) {
      this.key = input.apiKey;
      this.source = 'memory';
      this.disabled = false;
    }
    if (input.persist === true) {
      if (!this.key || this.disabled)
        throw new Error('Enter an API key before saving a connection');
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify({ apiKey: this.key, model: this.model }), {
        mode: 0o600,
      });
      chmodSync(this.filePath, 0o600);
      this.source = 'local-file';
    } else if (input.persist === false || input.apiKey) {
      if (existsSync(this.filePath)) unlinkSync(this.filePath);
      if (this.key) this.source = 'memory';
    } else if (this.source === 'local-file' && input.model) {
      writeFileSync(this.filePath, JSON.stringify({ apiKey: this.key, model: this.model }), {
        mode: 0o600,
      });
      chmodSync(this.filePath, 0o600);
    }
    return this.status();
  }
  async test(request: typeof fetch = fetch) {
    const { apiKey, model } = this.get();
    if (!apiKey) throw new Error('Connect an OpenAI API key first');
    let response: Response;
    try {
      response = await request(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new Error('Connection check could not reach OpenAI. Check the network and try again.');
    }
    if (!response.ok)
      throw new Error(
        `OpenAI connection check failed (${response.status}). Check the key, project access, and model name.`,
      );
    return {
      ok: true,
      model,
      message: 'Key and model access confirmed. No generation request was made.',
    };
  }
}

let singleton: ConnectionManager | undefined;
export function connectionManager() {
  return (singleton ??= new ConnectionManager());
}
export function getConnection() {
  return connectionManager().get();
}
export function connectionStatus() {
  return connectionManager().status();
}
