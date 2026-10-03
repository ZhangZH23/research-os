import initSqlJs from 'sql.js';
// Compiled by the host; Workers never compiles arbitrary WASM bytes at runtime.
import wasm from './sql-wasm.wasm';
let pending: ReturnType<typeof initSqlJs> | undefined;
export function sqlite() {
  return (pending ??= initSqlJs({
    instantiateWasm(
      imports: WebAssembly.Imports,
      receive: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
    ) {
      const instance = new WebAssembly.Instance(wasm, imports);
      receive(instance, wasm);
      return instance.exports;
    },
  } as any));
}
