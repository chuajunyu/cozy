"""Select diverse product families from observed IKEA category links."""
import concurrent.futures
import json
import re
from collections import Counter
from pathlib import Path
from ingest_ikea import fetch, ROOT

GROUPS = [
 ('sofas-fu003', 'Living', 'Sofa'),
 ('armchairs-chaise-longues-fu006', 'Living', 'Armchair'),
 ('coffee-side-tables-10705', 'Living', 'Coffee / side table'),
 ('single-bed-frames-16285', 'Bedroom', 'Bed'),
 ('bedside-tables-20656', 'Bedroom', 'Bedside table'),
 ('wardrobes-19053', 'Storage', 'Wardrobe'),
 ('chests-of-drawers-10451', 'Storage', 'Chest of drawers'),
 ('bookcases-10382', 'Storage', 'Bookcase'),
 ('desks-computer-tables-20649', 'Workspace', 'Desk'),
 ('office-chairs-computer-chairs-20652', 'Workspace', 'Office chair'),
 ('dining-tables-21825', 'Dining', 'Dining table'),
 ('dining-chairs-25219', 'Dining', 'Dining chair'),
]

def discover(group):
 slug,category,kind=group
 url=f'https://www.ikea.com/sg/en/cat/{slug}/'
 page=fetch(url).decode()
 urls=list(dict.fromkeys(u.split('#')[0] for u in re.findall(r'https://www\.ikea\.com/sg/en/p/[^"<>\\ ?]+',page)))
 counts=Counter();chosen=[]
 # Keep at most two variants per family; reserve room for different designs.
 for link in urls:
  family=link.split('/p/')[1].split('-')[0]
  if counts[family]>=2:continue
  chosen.append({'url':link,'category':category,'productType':kind,'discoveredFrom':url})
  counts[family]+=1
  if len(chosen)==10:break
 return chosen

if __name__=='__main__':
 target=ROOT/'data/ikea-urls.json'; existing=json.loads(target.read_text())
 seen={p['url'] for p in existing}
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
  for group,entries in zip(GROUPS,pool.map(discover,GROUPS)):
   print(group[2],len(entries),flush=True)
   for p in entries:
    if p['url'] not in seen:existing.append(p);seen.add(p['url'])
 target.write_text(json.dumps(existing,indent=2)+'\n')
 print('Total curated URLs:',len(existing))
