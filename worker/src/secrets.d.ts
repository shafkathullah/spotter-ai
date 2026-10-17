// Worker secrets are not declared in wrangler.jsonc (a `secrets.required` list would block the very
// first deploy until they exist), so `wrangler types` cannot see them. Declare them here instead.
//   wrangler secret put DJANGO_SECRET_KEY   (required in production)
//   wrangler secret put ORS_API_KEY         (optional: without it the backend uses the public OSRM server)
interface WorkerSecrets {
  DJANGO_SECRET_KEY?: string;
  ORS_API_KEY?: string;
}
declare namespace Cloudflare {
  interface Env extends WorkerSecrets {}
}
interface Env extends WorkerSecrets {}
