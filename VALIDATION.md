# Ellenőrzési eredmény — 2026-10-19

- Python: 14 sikeres teszt. HCL/JSON parser, `.tofu` elsőbbség, almodulok,
  hibajelzés, immutable források, archívumútvonalak és symlinkek kezelése.
- JavaScript és DOM: 25 sikeres teszt. Verziórendezés, feltételes teendők,
  dokumentált átnevezés, alapértékek, függőségek, state-deklarációk,
  nem modellezett forrásváltozások, dokumentumszűrés, exportformátum,
  valódi EKS 20 → 21 migráció és a teljes felhasználói folyamat.
- Statikus build: 102 tömörített snapshot referenciája, forráscommitja,
  motorválasztása és upstream licencszövege ellenőrizve.
- Előre indexelt adatok: 5 modul, összesen 51 stabil verzió, motoronként külön
  pillanatképpel. A katalógus gyűjtése sikeres; hiányzó anchor vagy meghiúsult
  verzió nincs.
- A publikus weboldal nem használ GitHub- vagy AI-tokent. Az adatokat saját
  statikus útvonalairól olvassa; ezt a DOM-teszt is ellenőrzi.

## Ismert ellenőrzési korlátok

- Vizuális böngészőellenőrzés nem volt elérhető. A DOM-teszt a működést
  ellenőrzi, nem igazolja a pixeles megjelenést vagy minden eszköz elrendezését.
- A Google Network v18.2.0, v18.3.0 és v18.3.1 kiadásának
  `modules/foundation/network` almoduljában két HCL-fájlt a rögzített parser
  nem tud feldolgozni. Ezeket a megfelelő almodul riportja hiányos elemzésként
  jelzi; nem ad kompatibilitási garanciát. A főmodul ettől külön vizsgálható.
- Terraform/OpenTofu CLI-kódot, infrastruktúrát vagy felhasználói state-et nem
  futtattunk és nem vizsgáltunk. A parser- és deklarációelemzés nem helyettesít
  egy konkrét projektben végzett validálást és plan ellenőrzést.
- Célrepository: https://github.com/CVTPRN/module-lens . Az éles GitHub CI és
  Pages-deploy állapota a repository Actions oldalán ellenőrizhető.

Újrafuttatás:

```bash
python -m unittest discover -s tests -p 'test_*.py' -v
npm ci
npm test
python scripts/build.py
```
