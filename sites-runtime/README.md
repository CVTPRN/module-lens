# Optional hosted preview adapter

The private preview uses Vinext / Cloudflare Workers. Its server-side route calls the same `server/registry-proxy.js` handler used by the standalone Node server and automated tests.

Create `app/api/registry/[operation]/route.ts` relative to the hosting project root:

```typescript
import { handleRegistry } from "../../../../server/registry-proxy.js";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return handleRegistry(request);
}
```

The hosting project copies the repository `web/` files into `public/`; its root page redirects to `/index.html`. The `server/` directory and `web/lib/registry.js` are synchronized from this repository rather than maintaining a separate comparison implementation.

Access control and build integration belong to the Sites project. This framework is optional: `app.py`, the Dockerfile or `node server/node-server.js` can independently run the full application and live API. Private project tokens are not stored in this repository.

The primary public application is hosted on [Render](https://module-lens.onrender.com).
