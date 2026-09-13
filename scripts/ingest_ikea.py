"""Curated IKEA SG page ingestion. Uses published JSON-LD, not a private API.
Run: python3 scripts/ingest_ikea.py data/ikea-urls.json
Downloaded IKEA assets remain local and are excluded from git.
"""
import concurrent.futures
import datetime
import json
import math
import html
import re
import struct
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]

def fetch(url):
    host = urlparse(url).hostname or ''
    if not (host == 'ikea.com' or host.endswith('.ikea.com')):
        raise ValueError('Expected an IKEA source URL')
    return subprocess.check_output(['curl', '--fail', '--silent', '--show-error', '--location', '--max-time', '45', '--max-filesize', '25000000', url])

def records(page):
    result=[]
    for raw in re.findall(r'<script[^>]*type=[\"\']application/ld\+json[\"\'][^>]*>(.*?)</script>', page, re.S):
        try:
            value=json.loads(raw)
            result.extend(value if isinstance(value,list) else value.get('@graph',[value]))
        except (ValueError,AttributeError):
            continue
    return result

def meters(value):
    match=re.fullmatch(r'\s*([0-9.]+)\s*(cm|mm|m)\s*',str(value or ''))
    return float(match[1])*{'m':1,'cm':.01,'mm':.001}[match[2]] if match else None

def measurement_table(page):
    rows=re.findall(r'<li[^>]*class="[^"]*measurements-tab__measurement-row[^"]*"[^>]*>(.*?)</li>',page,re.S)
    values={}
    for row in rows:
        name=re.search(r'class="[^"]*measurement-name[^"]*"[^>]*>(.*?)</span>',row,re.S)
        value=re.search(r'class="[^"]*measurement-value[^"]*"[^>]*>(.*?)</span>',row,re.S)
        if name and value:
            clean=lambda x:html.unescape(re.sub('<[^>]+>','',x)).strip()
            values[clean(name[1])]=clean(value[1])
    return values

def ingest(entry, existing=None):
    url=entry['url']; page=fetch(url).decode('utf-8'); data=records(page)
    p=next(v for v in data if v.get('@type')=='Product')
    offer=p.get('offers',{}); offer=offer[0] if isinstance(offer,list) else offer
    price_range=offer if offer.get('@type')=='AggregateOffer' else None
    if price_range:
        offer=next((o for o in price_range.get('offers',[]) if o.get('url','').rstrip('/')==url.rstrip('/') and o.get('price') is not None),{})
    sku=p.get('sku','').replace('.','')
    if not re.fullmatch(r'[0-9]{8}',sku):
        sku=re.search(r'(\d{8})/?$',url)[1]
    dimensions={k:meters(p.get(k)) for k in ['width','height','depth']}
    if dimensions['depth'] is None: dimensions['depth']=meters(p.get('length'))
    measurements=measurement_table(page)
    dimension_sources={k:'Product JSON-LD' for k,v in dimensions.items() if v is not None}
    for key,labels in {'width':['Width','Diameter'], 'depth':['Depth','Diameter','Length'], 'height':['Height','Max. height','Height including back cushions','Headboard height','Thickness']}.items():
        if dimensions[key] is None:
            for label in labels:
                value=meters(measurements.get(label))
                if value:
                    dimensions[key]=value;dimension_sources[key]='Visible measurements: '+label;break
    variant=p['name'].split(' - ',1)[-1] if ' - ' in p['name'] else ''
    variant=re.sub(r'\s+[0-9][0-9xX/. -]*\s*cm.*$','',variant).strip()
    color=p.get('color') or variant or None
    images=[i.get('contentUrl') if isinstance(i,dict) else i for i in p.get('image',[])]
    candidates=[e['contentUrl'] for v in data if v.get('@type')=='3DModel' for e in v.get('encoding',[]) if e.get('encodingFormat')=='model/gltf-binary']
    # Prefer ordinary self-contained GLB to avoid an external Draco decoder.
    candidates.sort(key=lambda u: ('/glb/' not in u, '/iqp2/' not in u, '/iqp1/' not in u))
    output={'description':p.get('description',''), 'productType':entry.get('productType') or p.get('category'), 'id':f'ikea-{sku}','articleNumber':p.get('sku'), 'name':p['name'],'category':entry['category'], 'sourceCategory':p.get('category'), 'brand':p.get('brand',{}).get('name','IKEA'),'color':color, 'variantLabel':variant, 'colorSource':'Product JSON-LD' if p.get('color') else 'Product variant label', 'measurements':measurements, 'dimensionSources':dimension_sources, 'price':float(offer['price']) if offer.get('price') is not None else None,'currency':offer.get('priceCurrency'), 'productUrl':url,'dimensionsMeters':dimensions,'images':images,'thumbnailUrl':images[0] if images else None,'availability':offer.get('availability'),'fetchedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'modelCandidates':candidates,'modelStatus':'unavailable','modelUrl':None,'modelSourceUrl':None,'modelLicense':'IKEA asset; local evaluation only. Redistribution rights not established.'}
    if price_range:
        output['priceRange']={k:price_range.get(k) for k in ['lowPrice','highPrice']}
        output['priceNote']='Page-listed offer; conditions may apply. Verify the current price at IKEA.'
    if offer.get('priceValidUntil'): output['priceValidUntil']=offer['priceValidUntil']
    errors=[]
    if existing and existing.get('modelStatus')=='downloaded' and (ROOT/'frontend/public'/existing['modelUrl'].lstrip('/')).exists():
        for key in ['modelUrl','modelSourceUrl','modelStatus','modelBytes','modelExtensions']:
            if key in existing:output[key]=existing[key]
    for model_url in ([] if output['modelStatus']=='downloaded' else candidates[:4]):
        try:
            blob=fetch(model_url)
            if blob[:4]!=b'glTF' or len(blob)<20 or struct.unpack_from('<I',blob,4)[0]!=2 or struct.unpack_from('<I',blob,8)[0]!=len(blob): raise ValueError('Invalid GLB header')
            n=struct.unpack_from('<I',blob,12)[0]; gltf=json.loads(blob[20:20+n])
            if any(v.get('uri') and not v['uri'].startswith('data:') for v in gltf.get('buffers',[])+gltf.get('images',[])): raise ValueError('Model has external dependencies')
            dest=ROOT/'frontend/public/models/ikea'/f'{sku}.glb';dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(blob)
            output.update(modelUrl=f'/models/ikea/{sku}.glb',modelSourceUrl=model_url,modelStatus='downloaded',modelBytes=len(blob),modelExtensions=gltf.get('extensionsRequired',[]))
            break
        except Exception as exc: errors.append(str(exc))
    if errors: output['modelDownloadErrors']=errors
    output['readyForPreview']=all(dimensions.values()) and output['modelStatus']=='downloaded' and output['price'] is not None and output['currency']=='SGD'
    return enrich(output)


FEATURE_RULES = {
    'Storage': r'with storage|storage space|storage compartment|storage under|built-in storage',
    'Drawers': r'with drawers|with a drawer|drawers? (?:give|provide|keep)|chest of [0-9]+ drawers',
    'Adjustable height': r'height.adjustable|adjust the height|adjustable height|sit.stand',
    'Extendable': r'extendable|extension leaf|extension leaves',
    'Foldable': r'foldable|folding|folds? (?:away|flat|up)',
    'Stackable': r'stackable|can be stacked|stack the chairs',
    'Removable cover': r'removable cover|cover is easy to keep clean.*remov',
    'Washable cover': r'machine.washable cover|cover.*machine wash',
    'Recliner': r'recliner|reclining',
    'Sofa bed': r'sofa.bed',
    'Swivel': r'swivel',
    'Cable management': r'cable management|cable outlet|cable outlets|cables.*out of sight',
    'Sliding doors': r'sliding doors',
    'Adjustable shelves': r'adjustable shelves|adjust the shelves',
    'Armrests': r'with armrests',
    'Chaise longue': r'chaise longue',
}

def enrich(product):
    # Use whole-object measurements. A plant-pot diameter is not foliage width.
    kind = product.get('productType')
    if product.get('category') == 'Workspace accessories':
        kind = product['productType'] = 'Desk accessory'
    measurements = product.get('measurements', {})
    if kind == 'Plant':
        height = meters(measurements.get('Height of plant'))
        if height and not product['dimensionsMeters'].get('height'):
            product['dimensionsMeters']['height'] = height
            product.setdefault('dimensionSources', {})['height'] = 'Visible measurements: Height of plant'
        product['placement'] = {'mode': 'floor' if (height or 0) > .8 else 'surface', 'canSupport': False}
        if 'hanging' in product['name'].lower():
            product['mountingNeedsReview'] = True
    if kind == 'Plant pot':
        diameter = meters(measurements.get('Outside diameter'))
        if diameter:
            for axis in ['width', 'depth']:
                if not product['dimensionsMeters'].get(axis):
                    product['dimensionsMeters'][axis] = diameter
                    product.setdefault('dimensionSources', {})[axis] = 'Visible measurements: Outside diameter'
    if kind in {'Vase', 'Plant pot', 'Candle holder', 'Desk accessory'}:
        product['placement'] = {'mode': 'surface', 'canSupport': False}
    placement_path = ROOT / 'data/ikea-placement.json'
    if placement_path.exists():
        product.update(json.loads(placement_path.read_text()).get(product['id'], {}))
    text=product.get('description','')
    source=product['name']+'. '+text
    features=[]; evidence={}
    sentences=re.split(r'(?<=[.!?])\s+',source)
    for label,pattern in FEATURE_RULES.items():
        matched=next((s for s in sentences if re.search(pattern,s,re.I) and not re.search(r'\b(?:not|no|without)\b',s,re.I)),None)
        if matched:
            features.append(label);evidence[label]=matched[:220]
    name=product['name'].lower()
    if re.search(r'\blamp\b|\buplighter\b|\bup/downlighter\b|\bspotlight\b',name) and not re.search(r'lampshade|lamp shade|lamp base|cord set',name):
        mount='wall' if re.search(r'wall',name) and not re.search(r'table/wall|ceiling/wall',name) else 'ceiling' if re.search(r'ceiling|pendant',name) else 'floor' if re.search(r'floor|uplighter',name) else 'surface'
        mode='rgb' if re.search(r'colou?r and white spectrum|change[^.!?]{0,60}colou?r',source,re.I) else 'white-spectrum' if re.search(r'white spectrum|warm to cold|warm to cool',source,re.I) else 'bulb-dependent' if not re.search(r'\bLED\b',product['name']) else 'fixed'
        product['lighting']={'mount':mount,'colorMode':mode,'dimmable':bool(re.search(r'dimmable|dim the light',source,re.I)),'evidence':'Capabilities extracted from product name and description. Bulb-dependent fixtures require a separately verified bulb; light output in Cozy is illustrative.'}
        features.append('Lighting')
        if mode in ['rgb','white-spectrum']:features.append('Adjustable light color')
        if mount == 'wall':
            product['placement'] = {'mode': 'wall', 'canSupport': False}
    if product.get('lighting'):
        total_height = meters(product.get('measurements', {}).get('Total height'))
        if total_height and not product['dimensionsMeters'].get('height'):
            product['dimensionsMeters']['height'] = total_height
            product.setdefault('dimensionSources', {})['height'] = 'Visible measurements: Total height'
        flux = re.fullmatch(r'([0-9.]+)\s*lm', product.get('measurements', {}).get('Luminous flux', ''))
        lumens = float(flux[1]) if flux else (1055 if product['lighting']['mount'] == 'ceiling' else 470)
        product['lighting']['output'] = {
            'lumens': lumens,
            'evidence': 'IKEA published luminous flux.' if flux else 'Assumed standard bulb output; bulb sold separately or output unverified.',
        }
    if re.search(r'\bmattress\b', name) and not re.search(r'bed|pad|protector|cover', name):
        product['placement'] = {'mode': 'surface', 'canSupport': False, 'surfaceKind': 'mattress'}
        if not product['dimensionsMeters'].get('height'):
            thickness = meters(product.get('measurements', {}).get('Thickness'))
            if thickness:
                product['dimensionsMeters']['height'] = thickness
                product.setdefault('dimensionSources', {})['height'] = 'Visible measurements: Thickness'
    # Manual model/axis review is separate from automatic name classification.
    mounting_path = ROOT / 'data/ikea-wall-mounts.json'
    mounting = json.loads(mounting_path.read_text()).get(product['id']) if mounting_path.exists() else None
    if mounting and product.get('lighting', {}).get('mount') == 'wall':
        product['wallMountReview'] = mounting['evidence']
        product['modelRotation'] = mounting['modelRotation']
        product['dimensionsMeters'] = dict(mounting['dimensionsMeters'])
        product['dimensionSources'] = dict(mounting['dimensionSources'])
        product['dimensionsMeasuredFromModel'] = mounting.get('dimensionsMeasuredFromModel', False)
        product['lighting']['emitter'] = mounting['emitter']
    elif product.get('lighting', {}).get('mount') == 'wall':
        product.pop('wallMountReview', None)
    product['features']=features
    product['featureEvidence']=evidence
    color=((product.get('color') or '')+' '+product.get('variantLabel','')).lower()
    product['colorFamilies']=[c for c in ['white','black','grey','beige','brown','blue','green','red','pink','yellow','orange'] if c in color.replace('gray','grey')]
    if any(w in color for w in ['oak','pine','bamboo','birch','walnut','wood','natural']):product['colorFamilies'].append('wood tones')
    if not product['colorFamilies'] and color:product['colorFamilies']=['other']
    product['materialsMentioned']=[m for m in ['solid wood','bamboo','pine','oak','birch','walnut','steel','aluminium','glass','rattan','leather','cotton','polyester'] if re.search(r'\b'+m+r'\b',source,re.I)]
    product['materialEvidenceSource']='Product name/description; mentions are not a full material composition.'
    gaps=[]
    if product.get('productType') in {'Wall shelf', 'Mirror', 'Kitchen wall storage', 'Decoration', 'Picture frame', 'Noticeboard'}:
        product['mountingNeedsReview'] = True
    # Explicit axis/mounting reviews survive re-ingestion and retain their sources.
    review_path = ROOT / 'data/ikea-home-reviews.json'
    if review_path.exists():
        product.update(json.loads(review_path.read_text(encoding='utf-8')).get(product['id'], {}))
    if product.get('mountingNeedsReview'):
        gaps.append('Decoration geometry and mounting need review')
    if re.search(r'\bclamp\b', name):
        gaps.append('Clamp mounting needs review')
    if product.get('lighting', {}).get('mount') == 'wall' and not product.get('wallMountReview'):
        gaps.append('Wall mounting geometry needs review')
    if product.get('modelStatus')!='downloaded':gaps.append('3D model unavailable')
    for key in ['width','height','depth']:
        n=product.get('dimensionsMeters',{}).get(key)
        if not isinstance(n,(float,int)) or not math.isfinite(n) or n<=0:gaps.append('Missing '+key)
    price=product.get('price')
    if not isinstance(price,(float,int)) or not math.isfinite(price) or price<0:gaps.append('Missing price')
    if product.get('currency')!='SGD':gaps.append('Missing SGD currency')
    for key in ['name','brand','color','productUrl','thumbnailUrl']:
        if not product.get(key):gaps.append('Missing '+key)
    product['missingFields']=gaps
    product['readyForPreview']=not gaps
    product['canRecommend']=not gaps and product.get('availability','').rsplit('/',1)[-1] in ['InStock','LimitedAvailability','PreOrder']
    name=product['name'].lower()
    type_rules=[('Mattress',r'^(?!.*(?:bed|pad|protector|cover)).*mattress'),('Bedside table',r'bedside|chest of 2 drawers'),('Sofa',r'sofa'),('Armchair',r'armchair|wing chair|easy chair|lounge chair'),('Bed',r'bed frame|bed,|day-bed'),('Wardrobe',r'wardrobe'),('Chest of drawers',r'chest of'),('Bookcase',r'bookcase|shelving unit'),('Office chair',r'office chair|swivel chair|gaming chair|desk chair'),('Desk',r'desk|laptop stand'),('Dining table',r'dining table|extendable table'),('Coffee / side table',r'coffee table|side table|tray table|nest of tables'),('Dining chair',r'chair'),('Lighting',r'lamp')]
    product['productType']=product.get('productType') if kind in {'Plant', 'Plant pot', 'Vase', 'Candle holder', 'Desk accessory', 'Picture frame'} else next((kind for kind,pattern in type_rules if re.search(pattern,name)),product.get('productType') or product.get('sourceCategory') or product['category'])
    return product

def save_catalogs(products, errors):
    products.sort(key=lambda p:p['id'])
    # Price bands are relative to each furniture type, never global across lamps and beds.
    for p in products:
        peers=sorted(q['price'] for q in products if q.get('productType')==p.get('productType') and isinstance(q.get('price'),(int,float)))
        if isinstance(p.get('price'),(int,float)) and len(peers)>=3:
            low=peers[(len(peers)-1)//3];high=peers[2*(len(peers)-1)//3]
            p['priceBand']='Budget' if p['price']<=low else 'Mid-range' if p['price']<=high else 'Premium'
        else:p['priceBand']='Unclassified'
        p['priceBandBasis']='Relative price terciles within the imported furniture type; not a quality rating.'
    ready=[p for p in products if p['readyForPreview']]
    review=[p for p in products if not p['readyForPreview']]
    def write(path,value):
        path.parent.mkdir(parents=True,exist_ok=True)
        temp=path.with_suffix('.tmp');temp.write_text(json.dumps(value,indent=2)+'\n');temp.replace(path)
    write(ROOT/'data/ikea-catalog.json',{'products':products,'errors':errors})
    write(ROOT/'data/ikea-ready.json',{'products':ready})
    write(ROOT/'data/ikea-review.json',{'products':review,'errors':errors})
    # Only complete products cross the frontend boundary.
    write(ROOT/'frontend/public/ikea-catalog.json',{'products':ready,'reviewCount':len(review),'totalCount':len(products)})

if __name__=='__main__':
    entries=list({e['url']:e for e in json.loads(Path(sys.argv[1]).read_text())}.values())
    if len(entries) > 1000:
        raise SystemExit('Curated ingestion is limited to 1000 products; split the work explicitly rather than silently truncating the catalog.')
    previous=ROOT/'data/ikea-catalog.json'
    cached=json.loads(previous.read_text()).get('products',[]) if previous.exists() and '--refresh' not in sys.argv else []
    allowed={e['url'] for e in entries}
    results=[p for p in cached if p['productUrl'] in allowed and p.get('price') is not None and (not p.get('modelUrl') or (ROOT/'frontend/public'/p['modelUrl'].lstrip('/')).exists())]
    results=[enrich(p) for p in results]
    done={p['productUrl'] for p in results}; entries=[e for e in entries if e['url'] not in done]
    errors=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        tasks={pool.submit(ingest,e):e for e in entries}
        for task in concurrent.futures.as_completed(tasks):
            try:
                result=task.result();results.append(result);print(result['name'],result['modelStatus'],flush=True); save_catalogs(results, errors)
            except Exception as exc: errors.append({'url':tasks[task]['url'],'error':str(exc)});print('FAILED',tasks[task]['url'],str(exc),flush=True)
    save_catalogs(results, errors)
    print(f'Saved {len(results)} products; {sum(bool(p["readyForPreview"]) for p in results)} ready for preview; {len(errors)} failed.')
