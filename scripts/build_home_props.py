"""Original approximate fairy lights, flower inserts and a bathroom fixture."""
import json
import math
from scripts.build_unbranded import ROOT, box, sphere, cylinder, preview
from backend.products import GeneratedProduct


def home_products():
    products = []
    for id, color in [('meadow-bouquet','#e4b785'),('pink-peony-bouquet','#d992ad'),('white-blossom-bouquet','#f7ead2'),('eucalyptus-insert','#739679')]:
        parts = [cylinder((.015,.32,.015),(0,.16,0),'#456443')]
        for i in range(7):
            a=i*2.4; x=math.cos(a)*.09; z=math.sin(a)*.09; y=.29+(i%3)*.035
            parts.append(sphere((.04,.13,.07),(x*.7,.24,z*.7),'#739065'))
            parts.append(sphere((.09,.06,.09),(x,y,z),color))
            if id != 'eucalyptus-insert':
                parts.append(sphere((.026,.027,.026),(x,y+.026,z),'#eac66d'))
        products.append(dict(id=id,name=id.replace('-',' ').title(),category='Flowers',productType='Bouquet insert',price=15,dimensions=[.28,.4,.28],parts=parts,placement=dict(mode='surface',canSupport=False,surfaceKind='bouquet',stemDiameter=.015)))
    for width, label in [(2,'Warm fairy lights'),(1.2,'Mini fairy lights')]:
        parts=[]
        for i in range(75):
            x=-width/2+.02+(width-.04)*i/74
            y=.1+.22*(math.cos(i/74*math.pi*4)+1)/2
            parts.append(sphere((width/65,.012,.012),(x,y,0),'#796b54'))
            if i%4 == 0:
                parts.append({**sphere((.025,.035,.025),(x,y-.025,.009),'#fff3c5'),'glow':True})
        products.append(dict(id=label.lower().replace(' ','-'),name=label,category='Lighting',productType='Fairy lights',price=19,dimensions=[width,.35,.04],parts=parts,placement=dict(mode='wall',canSupport=False),lighting=dict(mount='wall',colorMode='rgb',dimmable=True,evidence='Original decorative chain; span, bulb spacing and light output are planning estimates.',emitter=[0,.17,.015],output=dict(lumens=80,evidence='Illustrative low-output decorative lighting.'))))
    products.append(dict(id='ceramic-toilet',name='Ceramic toilet · close coupled',category='Bathroom',productType='Toilet',price=250,dimensions=[.38,.78,.68],placement=dict(mode='floor',canSupport=False),parts=[
        box((.35,.39,.17),(0,.585,-.255),'#f0eeea'),box((.37,.035,.19),(0,.763,-.255),'#f8f6f2'),
        sphere((.36,.21,.49),(0,.335,.065),'#edeae3'),sphere((.27,.04,.35),(0,.438,.07),'#b8c5c5'),
        cylinder((.2,.28,.3),(0,.14,.03),'#f0eeea'),box((.065,.018,.035),(0,.782,-.26),'#a3aaac')]))
    for p in products:
        p['priceNote']='Unbranded planning estimates for geometry and budget; not an IKEA product.'
    return products


def main():
    path=ROOT/'data/unbranded.json'
    existing={p['id']:p for p in json.loads(path.read_text())}
    for p in home_products():
        GeneratedProduct.model_validate(p)
        existing[p['id']]=p
        (ROOT/f'frontend/public/previews/unbranded/{p["id"]}.svg').write_text(preview(p),encoding='utf-8')
    path.write_text(json.dumps(list(existing.values()),indent=2)+'\n')
    print('Added four arrangements, two fairy light chains and a toilet.')


if __name__ == '__main__':
    main()
