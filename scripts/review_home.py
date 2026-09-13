"""Apply bounded IKEA home reviews using published measurements and local GLB bounds.

Run node scripts/model_bounds.mjs .cache/model-bounds.json first. The resulting
sidecar is versioned so asset preparation never needs to guess these dimensions.
"""
import json
from scripts.ingest_ikea import ROOT, enrich, meters, save_catalogs


def main():
    data = json.loads((ROOT/'data/ikea-catalog.json').read_text())
    bounds = json.loads((ROOT/'.cache/model-bounds.json').read_text())
    reviews = {}
    for p in data['products']:
        if p['id'] not in bounds:
            continue
        kind, name = p['productType'], p['name'].lower()
        size = bounds[p['id']]['size']
        dims = dict(p['dimensionsMeters'])
        m = p.get('measurements', {})
        review = {}
        # Two specific floor models are wider in the GLB's X axis than IKEA's
        # width axis. Rotate the geometry instead of stretching it sideways.
        if p['id'] in {'ikea-00610614','ikea-20372155','ikea-70610620','ikea-30513881'}:
            review['modelRotation'] = [0,90,0]
            size = [size[2],size[1],size[0]]
        if p['id'] == 'ikea-00466697':
            reviews[p['id']] = {'mountingNeedsReview': True, 'dimensionNote': 'Downloaded cot model footprint differs from the published variant; held for review.'}
            continue
        wall = kind in {'Mirror','Noticeboard','Picture frame','Decoration'} and not any(w in name for w in ['clock','hook','hanger','table mirror','standing mirror'])
        if wall:
            if size[2] > .22:
                continue
            # The black SVENSAS GLB is landscape; use the matching portrait pose.
            if p['id'] == 'ikea-10440367':
                review['modelRotation'] = [0,0,90]
                size = [size[1],size[0],size[2]]
            for axis, labels in {'width':['Frame width','Width','Diameter'], 'height':['Frame height','Height','Length','Diameter'], 'depth':['Frame, depth','Frame depth','Depth']}.items():
                dims[axis] = next((meters(m[label]) for label in labels if meters(m.get(label))), None)
            # Sets in one GLB have a spread-out footprint, not a single print's size.
            arranged = 'set of' in name or m.get('Package quantity') == '2 pieces'
            if arranged:
                dims = dict(zip(['width','height','depth'], size))
                review['dimensionNote'] = 'Whole displayed arrangement measured from the IKEA model; individual print sizes are listed at IKEA.'
            for i, axis in enumerate(['width','height','depth']):
                if dims[axis] is None:
                    dims[axis] = round(size[i],4)
            if not arranged and any(abs(dims[a]/size[i]-1) > .12 for i,a in enumerate(['width','height'])):
                continue
            review.update(mountingNeedsReview=False, category='Mirrors' if kind == 'Mirror' else 'Boards' if kind == 'Noticeboard' else 'Wall art', placement={'mode':'wall','canSupport':False})
            # Flat, unobstructed mirror fronts only. Table/standing and shelf
            # mirrors remain ordinary geometry until their tilted pane is reviewed.
            if kind == 'Mirror' and p['id'] != 'ikea-50470866':
                border = .045 if any(w in name for w in ['nissedal','svansele','toftbyn']) else .014
                shape = 'ellipse' if 'Diameter' in m else 'rounded' if 'lindbyn' in name else 'rectangle'
                review['reflection'] = {'width':dims['width']-2*border, 'height':dims['height']-2*border,
                                        'center':[0,dims['height']/2,dims['depth']/2+.001], 'shape':shape}
            if not p.get('color'):
                review['color'] = 'clear mirror glass'
        elif kind in {'Cot','Baby toy','Changing table','Bathroom accessory','Bathroom stool'} or (kind == 'Mirror' and ('table mirror' in name or 'standing mirror' in name)):
            if 'corner wall' in name:
                reviews[p['id']] = {'mountingNeedsReview':True}
                continue
            for axis, labels in {'width':['Base diameter'], 'depth':['Max. depth','Depth changing table','Base diameter'], 'height':['Height changing table','Height']}.items():
                if not dims.get(axis):
                    dims[axis] = next((meters(m[label]) for label in labels if meters(m.get(label))), None)
            known = [dims[a]/size[i] for i,a in enumerate(['width','height','depth']) if dims.get(a)]
            if not known or any(abs(r-1) > .12 for r in known):
                # Scattered toy pieces and ambiguous variants stay in review.
                review['mountingNeedsReview'] = True
                reviews[p['id']] = review
                continue
            for i, axis in enumerate(['width','height','depth']):
                if not dims[axis]: dims[axis] = round(size[i],4)
            review['placement'] = {'mode':'wall' if 'suction cup' in name else 'surface' if (kind == 'Baby toy' and 'gym' not in name) or kind == 'Bathroom accessory' or 'table mirror' in name else 'floor', 'canSupport':False}
            review['mountingNeedsReview'] = False
        elif p['id'] == 'ikea-60408987':
            reviews[p['id']] = {'mountingNeedsReview':True, 'dimensionNote':'Corner mounting requires review.'}
            continue
        elif p['id'] == 'ikea-00537671':
            dims = {'width':.22,'height':.20,'depth':round(size[2],4)}
            review['dimensionNote'] = 'IKEA: height 20 cm, length 22 cm, nominal diameter 10 cm. Model footprint: 22 × 8.3 cm; length maps to width. Depth measured from the model.'
        elif kind in {'Vase','Plant pot'} and p.get('readyForPreview'):
            # Decorative anchors are intentionally approximate, never presented
            # as a manufacturer's opening diameter or horticultural fit claim.
            w,h,d = (dims[a] for a in ['width','height','depth'])
            opening = min(w,d)*.28
            review['placement'] = {'mode':'surface','canSupport':False, 'support':{
                'kind':'bouquet','width':opening,'depth':opening,'height':h*.55,'center':[0,0],
                'evidence':'Approximate decorative stem insertion anchor, inferred from outer bounds; not a measured opening.'}}
        else:
            continue
        if any(not dims.get(a) for a in ['width','height','depth']):
            continue
        review['dimensionsMeters'] = dims
        review['dimensionSources'] = {a: 'Published IKEA measurement, checked against GLB axes; absent dimensions from transformed GLB bounds.' for a in dims}
        review['dimensionsMeasuredFromModel'] = True
        review.setdefault('dimensionNote','Published overall measurements; absent dimensions (including panel thickness) measured from the IKEA model. Reviewed orientation.')
        reviews[p['id']] = review
    (ROOT/'data/ikea-home-reviews.json').write_text(json.dumps(reviews,indent=2)+'\n')
    save_catalogs([enrich(p) for p in data['products']],data.get('errors',[]))
    print(f'Reviewed {len(reviews)} home products.')


if __name__ == '__main__':
    main()
