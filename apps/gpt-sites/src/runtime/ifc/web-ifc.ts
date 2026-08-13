import { IfcAPI, IFCDOOR } from "web-ifc";
import webIfcWasmModule from "web-ifc/web-ifc.wasm?module";

export const IFC_ENGINE_ID = "web-ifc-wasm";
export const IFC_ENGINE_VERSION = "0.0.77";

export type IfcProbeResult = {
  engineId: string;
  engineVersion: string;
  schemaName: string;
  totalEntities: number;
  doorCount: number;
  durationMs: number;
};

export type IfcModelOperation<T> = (
  api: IfcAPI,
  modelId: number,
) => T | Promise<T>;

let apiInitialization: Promise<IfcAPI> | undefined;
let parserQueue: Promise<void> = Promise.resolve();
const WEB_IFC_OPTIONS_KEY = Symbol.for("bim-review-agent.web-ifc-options");

function ensureEmscriptenWorkerRuntime(): void {
  const runtime = globalThis as typeof globalThis & {
    WorkerGlobalScope?: unknown;
  };

  // web-ifc's browser build expects this marker even though Workerd exposes the
  // rest of the Worker APIs without the DOM WorkerGlobalScope constructor.
  if (!runtime.WorkerGlobalScope) {
    Object.defineProperty(runtime, "WorkerGlobalScope", {
      configurable: true,
      value: class WorkerGlobalScope {},
    });
  }

  (runtime as unknown as Record<symbol, unknown>)[WEB_IFC_OPTIONS_KEY] = {
    instantiateWasm(
      imports: WebAssembly.Imports,
      receiveInstance: (
        instance: WebAssembly.Instance,
        module: WebAssembly.Module,
      ) => void,
    ) {
      const instance = new WebAssembly.Instance(webIfcWasmModule, imports);
      receiveInstance(instance, webIfcWasmModule);
      return instance.exports;
    },
  };
}

function getApi(): Promise<IfcAPI> {
  if (!apiInitialization) {
    ensureEmscriptenWorkerRuntime();
    const api = new IfcAPI();
    apiInitialization = api
      .Init(undefined, true)
      .then(() => api)
      .catch((error) => {
        apiInitialization = undefined;
        throw error;
      });
  }
  return apiInitialization;
}

async function withParserLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = parserQueue;
  let release: (() => void) | undefined;
  parserQueue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return await operation();
  } finally {
    release?.();
  }
}

function vectorSize(vector: { size(): number }): number {
  const size = vector.size();
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error("The IFC parser returned an invalid entity count.");
  }
  return size;
}

export async function withIfcModel<T>(
  bytes: Uint8Array,
  operation: IfcModelOperation<T>,
): Promise<T> {
  return withParserLock(async () => {
    const api = await getApi();
    const modelId = api.OpenModel(bytes, {
      MEMORY_LIMIT: 256 * 1024 * 1024,
      COORDINATE_TO_ORIGIN: false,
    });
    if (modelId < 0) {
      throw new Error("The IFC parser rejected the model.");
    }

    try {
      return await operation(api, modelId);
    } finally {
      api.CloseModel(modelId);
    }
  });
}

export async function probeIfc(
  bytes: Uint8Array,
): Promise<IfcProbeResult> {
  return withIfcModel(bytes, (api, modelId) => {
    const startedAt = performance.now();
    return {
      engineId: IFC_ENGINE_ID,
      engineVersion: IFC_ENGINE_VERSION,
      schemaName: api.GetModelSchema(modelId),
      totalEntities: vectorSize(api.GetAllLines(modelId)),
      doorCount: vectorSize(api.GetLineIDsWithType(modelId, IFCDOOR, true)),
      durationMs: Math.max(1, Math.round(performance.now() - startedAt)),
    };
  });
}

export async function parserHealth(): Promise<{
  status: "available" | "unavailable";
  engineId: string;
  engineVersion: string;
  detail?: string;
}> {
  try {
    await getApi();
    return {
      status: "available",
      engineId: IFC_ENGINE_ID,
      engineVersion: IFC_ENGINE_VERSION,
    };
  } catch {
    return {
      status: "unavailable",
      engineId: IFC_ENGINE_ID,
      engineVersion: IFC_ENGINE_VERSION,
      detail: "The Site-compatible IFC WASM module could not initialize.",
    };
  }
}
