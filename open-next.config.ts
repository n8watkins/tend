import { defineCloudflareConfig } from '@opennextjs/cloudflare'

// Every page is dynamic (signed in, or rendered with a per-request CSP nonce),
// so there is no ISR cache to configure.
export default defineCloudflareConfig({})
