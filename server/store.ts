import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Store as DomainStore } from './domain-store';
export class Store extends DomainStore {
  constructor(path: string, seed = true, projectId?: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    super(new DatabaseSync(path), seed, projectId);
  }
}
