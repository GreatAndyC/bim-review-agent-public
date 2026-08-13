declare module "*.wasm?url" {
  const url: string;
  export default url;
}

declare module "*.wasm?module" {
  const wasmModule: WebAssembly.Module;
  export default wasmModule;
}

declare module "*.ifc?raw" {
  const source: string;
  export default source;
}
