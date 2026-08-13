declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      BIM_REVIEW_UPLOADS_ENABLED?: string;
    }
  }
}

export {};
