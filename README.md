# ModuleLens

Terraform-modulok keresése a **teljes nyilvános Terraform Registryben**, minden publikált verzió lekérésével és két verzió összehasonlításával.

Az új kereső a felhasználó által megadott `app.py`, `app.js`, `index.html` és `styles.css` prototípusra épül. A korábbi OpenTofu-elemző külön nézetben megmaradt.

[Működő webes változat (privát hozzáférés)](https://module-lens-registry.azurebeech10.chatgpt.site)

## Terraform Registry: élő működés

- Kulcsszavas keresés és pontos `névtér/név/provider` modulcím megadása.
- Registry-oldal URL-je és `//modules/...` almodulcím is használható.
- A teljes nyilvános katalógus böngészése és lapozása, előre megadott modullista nélkül.
- Provider szerinti szűrés; az összes provider választható moduljai elérhetők.
- Minden közzétett szemverziós verzió lekérése, prerelease-támogatással.
- Két verzióhoz tartozó almodulok kiválasztása.
- Új, törölt és módosult inputok/outputok; elérhető provider- és modulfüggőségek; erőforráslisták.
- Minden eltérés mellett érintettségi feltétel, teendő és Registry-forráshivatkozás.
- Lehetséges átnevezések külön, bizonytalan javaslatként; a törlést és hozzáadást nem fedik el.
- JSON/Markdown export és megosztható összehasonlítási URL.
- Mobilon is használható magyar felület, billentyűzetes keresési találatválasztás.

A „teljes Registry” az élő API keresési tartományát jelenti, nem minden modul helyi másolatát. Egyszerre 24 találat töltődik be; a **További modulok betöltése** folytatja a lapozást. Nincs kézzel karbantartandó Terraform-modul-lista vagy indexeltverzió-korlát.

## Indítás helyben

A teljes alkalmazáshoz **Python 3.12+** elég; a szerver nem igényel külső Python-csomagot:

```bash
python app.py --port 8080
```

Nyisd meg: **http://localhost:8080/**.

A szerver ugyanarról az originről szolgálja ki a felületet és az élő Registry API-t. Tokent vagy saját kódot nem kell megadni. A `npm run serve` is ezt a szervert indítja.

### Docker

```bash
docker compose up --build
```

Alapértelmezetten csak a helyi gépen, a **http://localhost:8080/** címen figyel. Saját hosztoláshoz a Dockerfile használható tetszőleges konténerfuttatón; az alkalmazás a konténer 8080-as portján működik.

## GitHub és hosztolás

A teljes forráskód a https://github.com/CVTPRN/module-lens repóban van.

**GitHub Pages önmagában nem futtatja az élő Registry API-t.** A Registry válaszai jelenleg nem adnak böngészős, más originről használható CORS-engedélyt, ezért a weboldalnak szerveroldali közvetítés kell. A statikus Pages-oldal ezt világosan jelzi, és konfigurált hosztolt alkalmazás esetén annak linkjét mutatja; nem állítja, hogy a keresés API nélkül működik.

Támogatott futtatási módok:

| Mód | Élő teljes Registry | OpenTofu-pillanatképek |
|---|---|---|
| `python app.py` | Igen | Igen |
| Docker | Igen | Igen |
| Szerveres webes hosztolás | Igen | Igen |
| GitHub Pages / statikus tárhely | Külön szerveres alkalmazás szükséges | Igen |

A privát hosztolt változat teljes weboldalt és szerveroldali API-t tartalmaz. A hozzáférést a hosztolási platform kezeli; a privát működést a publikus Registry-adatok nem változtatják nyilvánossá. A publikussá tétel külön hozzáférés-beállítás.

Node.js 22+ környezetben csomagtelepítés nélkül is indítható:

```bash
node server/node-server.js
```

A `PORT` és `HOST` környezeti változókkal konfigurálható.

## API

Mindkét kiszolgáló ugyanazt a korlátozott, csak olvasásra alkalmas API-t biztosítja:

```text
GET /api/registry/health
GET /api/registry/search?q=network&provider=azurerm&offset=0&limit=24
GET /api/registry/versions?module=terraform-aws-modules/ec2-instance/aws
GET /api/registry/module?module=terraform-aws-modules/ec2-instance/aws&version=6.0.0
```

Üres `q` esetén a Registry teljes katalóguslistájából történik a lapozás. A frontend a kiválasztott két verzió metaadatait hasonlítja össze; nem kell összehasonlítási feladatot indítani GitHub Actionsben.

A Python-szerver (`app.py`) és a hosztolt JavaScript-adapter (`server/registry-proxy.js`) kizárólag a rögzített `registry.terraform.io/v1/modules` originre küld GET kéréseket. Nincs tetszőleges URL-proxy, nincs upstream átirányítás-követés, és a látogatók cookie-ja vagy Authorization fejléce nem kerül a Registryhez. Időkorlát, válaszméret-korlát és korlátozott memóriás gyorsítótár védi a lekéréseket.

## OpenTofu nézet

A **OpenTofu →** link az `opentofu.html` oldalt nyitja meg. Ez megőrzi az eredeti, forrásból feldolgozott HCL/JSON-pillanatképek összehasonlítását, a `.tofu` fájlok elsőbbségét és a dokumentált migrációs útmutatókat.

Ebben a nézetben továbbra is a `modules.json` szerinti válogatott katalógus és verziók szerepelnek: AWS EKS, VPC, S3; Google Network és GKE. Az élő teljes Registry-keresés a Terraform főoldalon érhető el.

```bash
# OpenTofu-pillanatképek frissítése
python -m pip install -r requirements.txt
python -m collector.collect

# Egy modul frissítése
python -m collector.collect --only aws-eks
```

## Tesztelés

```bash
python -m pip install -r requirements.txt
npm ci
python -m unittest discover -s tests -p 'test_*.py' -v
npm test
python scripts/build.py
```

A tesztek között szerepel valódi EC2 Registry-moduladatok összehasonlítása (az eredeti öt modultól függetlenül), 1200 verzió kezelése, szemverziós sorrend, hiányzó Registry-mezők, feltételes teendők, lapozás, providerfilter, elavult aszinkron válaszok, HTTP útvonalvédelem és a meglévő OpenTofu-folyamat.

A DOM-tesztek nem vizuális böngészőtesztek. A részletes ellenőrzési állapotot a `VALIDATION.md` tartalmazza.

## Az eredmények korlátai

A Terraform Registry nézet **a közzétett metaadatokat** hasonlítja össze. Nem értékeli a felhasználó kódját, a kifejezéseket, outputértékeket, validációs blokkokat vagy state-et, és nem vizsgálja a köztes kiadások teljes migrációs történetét. Egy hiányzó Registry-mező nem bizonyít törlést vagy kódváltozást; az ilyen eltérés ellenőrizendőként jelenik meg.

A lehetséges átnevezés hasonló névből és azonos részletes leírásból származó javaslat. Nem bizonyított megfeleltetés, ezért a régi és az új elem önállóan is szerepel.

A tényleges infrastruktúrahatást a saját környezetben készített Terraform/OpenTofu plan alapján kell megítélni. Az „itt nem találtunk eltérést” eredmény nem problémamentes frissítési garancia.

## Fájlok

- `web/index.html`, `web/registry-app.js`, `web/registry-styles.css`: a megadott prototípus alapján készült élő Registry-felület.
- `web/lib/registry.js`: külön tesztelhető Registry-metaadat-összehasonlító.
- `app.py`: csomagfüggőség nélküli Python HTTP- és Registry-kiszolgáló.
- `server/registry-proxy.js`: a szerveres webes hosztolás azonos API-t adó adaptere.
- `sites-runtime/`: a hosztolt adapter belépési pontjai és szinkronizálási útmutatója.
- `web/opentofu.html`, `web/app.js`, `collector/`: a korábbi HCL-alapú OpenTofu-nézet.
- `web/site.json`: projektlinkek; nem tartalmaz titkot vagy tokent.
- `.github/workflows/`: CI, a válogatott pillanatképek frissítése és a statikus Pages-belépő csomagolása.

Az alkalmazáskód MIT-licencű; a Registry-metaadatok és upstream dokumentumok a szerzőik feltételei alatt maradnak. Lásd: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

[Hivatalos Registry API](https://developer.hashicorp.com/terraform/registry/api-docs)
