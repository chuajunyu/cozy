"""Recover visible measurements and features without redownloading cached models."""
import concurrent.futures
import json
from ingest_ikea import ROOT, ingest, enrich, save_catalogs
if __name__=='__main__':
 data=json.loads((ROOT/'data/ikea-catalog.json').read_text()); products=data['products']; entries={e['url']:e for e in json.loads((ROOT/'data/ikea-urls.json').read_text())}
 targets=[p for p in products if not p.get('description') or any(m!='3D model unavailable' for m in p.get('missingFields',[])) or not p.get('colorFamilies')]
 result={p['id']:enrich(p) for p in products};errors=data.get('errors',[])
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
  tasks={pool.submit(ingest,entries[p['productUrl']],p):p for p in targets}
  for task in concurrent.futures.as_completed(tasks):
   try:
    p=task.result();result[p['id']]=p;print(p['name'],p['missingFields'],flush=True);save_catalogs(list(result.values()),errors)
   except Exception as e:print('Metadata refresh failed',tasks[task]['name'],str(e),flush=True)
 save_catalogs(list(result.values()),errors)
