declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    TEST_ACCOUNTS_JSON?: string;
    UNIVERSITY_KEY_JSON?: string;
    ROLE_EMAILS_JSON?: string;
    BREVO_API_KEY?: string;
    MAIL_FROM?: string;
    APP_ORIGIN?: string;
    BUCKET?: R2Bucket;
  }
}
