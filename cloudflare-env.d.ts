declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    TEST_ACCOUNTS_JSON?: string;
    SIGNING_KEYS_JSON?: string;
    ROLE_EMAILS_JSON?: string;
    RESEND_API_KEY?: string;
    MAIL_FROM?: string;
    APP_ORIGIN?: string;
    BUCKET?: R2Bucket;
  }
}
