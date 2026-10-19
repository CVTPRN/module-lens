# A hosztolt adapter

A működő privát webes változat Vinext / Cloudflare Workers környezetben fut.
A szerveroldali route ugyanazt a `server/registry-proxy.js` handlert használja,
amelyet a Node-kiszolgáló és az automatikus tesztek is.

`app/api/registry/[operation]/route.ts` a hosztolási projekt gyökeréhez képest:

```typescript
import { handleRegistry } from "../../../../server/registry-proxy.js";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return handleRegistry(request);
}
```

A hosztolási projekt `public/` könyvtára a repó `web/` fájljait tartalmazza;
az alapoldal a `/index.html` címre irányít. A `server/` és a
`web/lib/registry.js` a repóból szinkronizált alkalmazáskód, nem külön
összehasonlítási implementáció.

A hosztolási platform hozzáférési és build-integrációja a Sites-projekt része.
Saját tárhelyhez nem szükséges ez a keretrendszer: a repóban található teljes
`app.py`, Dockerfile vagy `node server/node-server.js` önállóan futtatja az
alkalmazást és az élő API-t. Privát projekthez tartozó token nem része a repónak.
