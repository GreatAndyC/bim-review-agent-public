import type { StoredAgentReviewResult } from "@/src/contracts/storage";

const DATABASE_NAME = "bim-review-agent-history-v1";
const DATABASE_VERSION = 1;
const STORE_NAME = "runs";

export type LocalHistoryEntry = {
  id: string;
  saved_at: string;
  result: StoredAgentReviewResult;
};

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !window.indexedDB) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open local history."));
  });
}

export async function listHistory(): Promise<LocalHistoryEntry[]> {
  const database = await openDatabase();
  if (!database) return [];
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => {
      database.close();
      const entries = (request.result as LocalHistoryEntry[]).slice().sort((left, right) => right.saved_at.localeCompare(left.saved_at));
      resolve(entries);
    };
    request.onerror = () => {
      database.close();
      reject(request.error ?? new Error("Unable to read local history."));
    };
  });
}

export async function saveHistory(result: StoredAgentReviewResult): Promise<void> {
  const database = await openDatabase();
  if (!database) return;
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put({
      id: result.agent_run.run_id,
      saved_at: new Date().toISOString(),
      result,
    } satisfies LocalHistoryEntry);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("Unable to save local history."));
    };
  });
}

export async function deleteHistory(id: string): Promise<void> {
  const database = await openDatabase();
  if (!database) return;
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("Unable to delete local history."));
    };
  });
}

export async function clearHistory(): Promise<void> {
  const database = await openDatabase();
  if (!database) return;
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).clear();
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("Unable to clear local history."));
    };
  });
}
