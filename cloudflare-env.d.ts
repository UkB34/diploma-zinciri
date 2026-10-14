declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    TEST_ACCOUNTS_JSON?: string;
    BUCKET?: R2Bucket;
  }
}
