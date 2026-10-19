# Ellenőrzési eredmény — 2026-10-19

- Python: 20 sikeres teszt; beleértve a tényleges HTTP-kiszolgálást és a Registry-útvonalak védelmét.
- JavaScript/DOM/Node: 46 sikeres teszt; a korábbi HCL-elemző mellett a teljes Registry-folyamat, lapozás, providerfilter, teljes verziólista, SemVer, hibakezelés, elavult válaszok, a standalone Node HTTP-kiszolgáló és a statikus tárhelyre figyelmeztető nézet.
- Az eredeti ötmodulos listától független, valódi Registry-adatokat használtunk a `terraform-aws-modules/ec2-instance/aws` 5.0.0 és 6.0.0 verzióihoz. A tesztfixture-ök a Registryből származnak.
- A teljes Registry-listázás élő lekérése 24 találatot és következő lapozási offsetet adott. Az Azure virtualnetwork keresés valós Azure-modulokat adott vissza.
- A verziókezelés 1200 elemű listával is tesztelt; nincs a korábbi indexelt listára korlátozva.
- A statikus build a meglévő 102 OpenTofu/Terraform-pillanatkép integritását is ellenőrzi.
- A privát szerveres webes változat natív publikálása sikeres.
- A hosztolt változaton a kezdőlap, az API-állapot, az Azure-modulkeresés, az EC2-modul teljes verziólistája és a 6.0.0-s verzió metaadatai is HTTP 200 választ adtak. Az EC2-verziólista 99 kiadást tartalmazott.

## Korlátok

- Vizuális böngészőellenőrzés nem volt elérhető. A DOM-tesztek a működést ellenőrzik, a megjelenést nem tanúsítják.
- A teljes Registry-keresés szerveroldali API-t igényel. A GitHub Pages nézet külön jelzi az API hiányát és a működő hosztolt alkalmazáshoz vezet.
- A Terraform Registry-nézet közzétett metaadatokat hasonlít össze; nem vizsgálja a felhasználó kódját, state-jét, outputkifejezéseit vagy az átugrott kiadások teljes migrációs történetét.
- A korábbi OpenTofu-nézetben a Google Network v18.2.0, v18.3.0 és v18.3.1 `modules/foundation/network` almoduljának két fájlját a rögzített HCL-parser nem tudja teljesen feldolgozni; ezt a riport hiányos elemzésként jelzi.

Újrafuttatás:

```bash
python -m pip install -r requirements.txt
npm ci
python -m unittest discover -s tests -p 'test_*.py' -v
npm test
python scripts/build.py
```
