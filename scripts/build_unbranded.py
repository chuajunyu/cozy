"""Rebuild original, portable room props and their geometry-derived SVG previews.

All sizes are explicit planning estimates, never manufacturer specifications.
Artwork is original geometric illustration, not reproduced movie artwork.
"""
import html
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CREAM, WOOD, INK = '#e6ddca', '#ac7850', '#242b36'


def part(shape, size, position, color):
    return dict(shape=shape, size=list(size), position=list(position), color=color)


def box(size, position, color):
    return part('box', size, position, color)


def sphere(size, position, color):
    return part('sphere', size, position, color)


def cylinder(size, position, color):
    return part('cylinder', size, position, color)


def monitor(w=.62, h=.46):
    return [box((w, h*.76, .035), (0, h*.62, -.035), INK),
            box((w-.025, h*.76-.025, .006), (0, h*.62, -.014), '#507d91'),
            box((w*.65, h*.08, .007), (-w*.1, h*.43, -.010), '#9ed4cb'),
            box((.04, h*.27, .045), (0, h*.16, -.04), INK),
            box((w*.43, .018, .2), (0, .009, 0), INK)]


def plant(w, h, color, kind):
    pot_h = h*.24
    parts = [cylinder((w*.5, pot_h, w*.5), (0, pot_h/2, 0), color),
             cylinder((w*.45, .014, w*.45), (0, pot_h, 0), '#544435'),
             cylinder((.016, h*.6, .016), (0, pot_h+h*.3, 0), '#566343')]
    for i in range(12):
        angle=i*2.399
        radius=w*(.16 if kind == 'succulent' else .26)
        y=pot_h + (h-pot_h)*(.18 + (i%4)*.2)
        parts.append(sphere((w*.43, (h-pot_h)*(.24 if kind == 'succulent' else .32), w*.32),
                            (math.cos(angle)*radius, y, math.sin(angle)*radius),
                            ['#426951','#739358','#98ae70'][i%3]))
    return parts


def art(w, h, palette, style):
    frame, bg, accent, second = palette
    parts=[box((w,h,.025),(0,h/2,0),frame), box((w-.035,h-.035,.008),(0,h/2,.016),bg)]
    if style == 'photo':
        parts += [box((w*.78,h*.36,.004),(0,h*.29,.023),second),
                  sphere((w*.26,h*.25,.005),(w*.19,h*.72,.025),accent),
                  sphere((w*.55,h*.29,.004),(-w*.12,h*.4,.026),accent)]
    elif style == 'cinema':
        parts += [sphere((w*.65,w*.65,.005),(0,h*.62,.024),accent),
                  box((w*.12,h*.35,.006),(0,h*.42,.029),second)]
        for i in range(4):
            parts.append(box((w*(.7-i*.08),.012,.005),(0,h*(.12+i*.025),.028),second))
    else:
        parts += [sphere((w*.63,h*.52,.005),(-w*.08,h*.59,.024),accent),
                  box((w*.29,h*.62,.006),(w*.19,h*.45,.028),second),
                  box((w*.7,h*.1,.006),(-w*.03,h*.2,.03),frame)]
    return parts


def guitar(electric=False):
    color='#ba663c' if not electric else '#5e8d8a'
    parts=[sphere((.35,.39,.10),(0,.29,0),color), sphere((.25,.30,.09),(0,.49,0),color),
           box((.055,.47,.045),(0,.755,0),WOOD),box((.08,.13,.045),(0,1.015,0),color),
           sphere((.10,.10,.008),(0,.43,.054),INK),box((.13,.025,.014),(0,.23,.06),INK)]
    for x in [-.018,-.011,-.004,.004,.011,.018]:
        parts.append(box((.0015,.69,.003),(x,.605,.061),'#c8bf9f'))
    for y in [.98,1.02,1.06]:
        parts.append(box((.11,.012,.014),(0,y,0),'#a7a7a4'))
    # Included protective stand makes the upright guitar a usable floor object.
    parts += stand()
    return parts


def stand():
    return [box((.34,.025,.3),(0,.0125,0),INK),box((.035,.57,.035),(0,.30,-.10),INK),
            box((.16,.025,.08),(0,.55,-.07),INK)]


def desk(w,h,color,depth=.7):
    parts=[box((w,.04,depth),(0,h-.02,0),color),box((w-.22,.07,.07),(0,h-.12,0),INK)]
    for x in [-w*.36,w*.36]:
        parts += [box((.075,h-.055,.075),(x,(h-.055)/2,0),INK),box((.09,.03,.62),(x,.015,0),INK)]
    return parts


def products():
    result=[]
    def add(id,name,category,size,parts,price=30,mode='surface',support=False,lighting=None,kind=None):
        p=dict(id=id,name=name,category=category,productType=kind or category,dimensions=size,parts=parts,price=price,
               priceNote='Unbranded planning placeholder. Dimensions are estimates; price is illustrative SGD. Original Cozy geometry.',
               placement=dict(mode=mode,canSupport=support))
        if lighting: p['lighting']=dict(mount=mode,colorMode='rgb',dimmable=True,evidence='Illustrative light, not measured photometry.',output=dict(lumens=300,evidence='Assumed decorative output.'))
        result.append(p)
    for id,name,w,h in [('monitor-27','27-inch desktop monitor',.62,.46),('monitor-ultrawide','Ultrawide gaming monitor',.82,.46),('monitor-24','24-inch desktop monitor',.55,.42)]:
        add(id,name,'Electronics',(w,h,.22),monitor(w,h),220,kind='Monitor screen')
    add('laptop','Open laptop','Electronics',(.34,.25,.25),[
        box((.34,.016,.25),(0,.008,0),'#939ba4'),box((.34,.24,.014),(0,.13,-.118),INK),
        box((.315,.205,.005),(0,.135,-.108),'#758dad'),box((.29,.003,.10),(0,.018,-.012),INK),
        box((.10,.003,.06),(0,.019,.077),'#b7bfc6')],900,kind='Laptop computer')
    for id,name,c in [('gaming-pc','RGB gaming PC tower',INK),('desktop-pc','White desktop PC tower','#dddcd6')]:
        parts=[box((.22,.46,.43),(0,.23,0),c),box((.185,.40,.006),(0,.24,.218),'#333b4c')]
        for y in [.1,.24,.38]:
            parts += [sphere((.12,.12,.007),(0,y,.224),'#75bdb4'),sphere((.08,.08,.008),(0,y,.229),'#776299')]
        add(id,name,'Electronics',(.22,.46,.46),parts,1100,kind='Gaming computer PC')
    add('keyboard','Mechanical keyboard','Electronics',(.44,.035,.14),[
        box((.44,.025,.14),(0,.0125,0),INK),
        *[box((.024,.01,.021),(-.194+x*.029,.03,-.046+y*.03),'#b6b3ab' if y else '#80aca4') for x in range(14) for y in range(4)]],80)
    add('mouse','Wireless mouse','Electronics',(.065,.043,.115),[sphere((.065,.04,.115),(0,.022,0),INK),box((.005,.004,.02),(0,.043,-.02),'#9bb1ae')],35)
    add('speakers','Desktop speaker pair','Electronics',(.48,.22,.16),[
        p for x in [-.16,.16] for p in [box((.13,.22,.16),(x,.11,0),WOOD),sphere((.10,.10,.008),(x,.095,.083),INK),sphere((.04,.04,.008),(x,.18,.083),INK)]],100)
    add('console','Game console','Electronics',(.1,.39,.26),[box((.07,.37,.24),(0,.185,0),INK),*[box((.015,.39,.26),(x,.195,0),'#dedfdc') for x in [-.043,.043]]],500)
    add('controller','Game controller','Electronics',(.16,.045,.105),[sphere((.16,.045,.08),(0,.025,0),'#ecebe3'),*[sphere((.035,.015,.035),(x,.046,.01),INK) for x in [-.04,.04]]],70)
    add('headphones','Headphones on stand','Electronics',(.20,.29,.16),[box((.16,.015,.16),(0,.0075,0),INK),box((.025,.24,.025),(0,.13,0),WOOD),box((.17,.023,.04),(0,.276,0),INK),*[sphere((.05,.11,.08),(x,.22,0),INK) for x in [-.075,.075]]],90)
    add('record-player','Record player','Music',(.42,.12,.34),[box((.42,.085,.34),(0,.043,0),WOOD),cylinder((.28,.015,.28),(-.035,.095,0),INK),cylinder((.06,.017,.06),(-.035,.099,0),'#d4a166'),box((.017,.016,.23),(.15,.112,0),'#c2c5c1')],180)
    add('amplifier','Guitar amplifier','Music',(.46,.43,.24),[box((.46,.43,.24),(0,.215,0),INK),box((.41,.32,.006),(0,.2,.123),'#857b68'),*[sphere((.014,.014,.007),(x,.39,.125),'#c7b590') for x in [-.14,-.07,0,.07,.14]]],160,mode='floor')
    add('acoustic-guitar','Acoustic guitar with stand','Music',(.36,1.08,.30),guitar(),170,mode='floor',kind='Guitar')
    add('electric-guitar','Electric guitar with stand','Music',(.36,1.08,.30),guitar(True),250,mode='floor',kind='Guitar')
    add('guitar-stand','Guitar stand','Music',(.34,.57,.30),stand(),25,mode='floor')
    for id,name,w,h,c,k in [('monstera','Monstera in clay pot',.6,1.1,'#b37c60','leaf'),('ficus','Tall ficus tree',.72,1.65,'#d2c8b3','leaf'),('fern','Fern in ceramic pot',.40,.55,'#d6ccbb','leaf'),('succulent','Desktop succulent',.16,.20,'#d2ac8a','succulent'),('bonsai','Mini bonsai',.32,.42,'#657a76','leaf'),('palm','Indoor palm',.72,1.45,'#b3a083','leaf')]:
        add(id,name,'Plants',(w,h,w),plant(w,h,c,k),35,mode='floor' if h>1 else 'surface',kind='Potted plant')
    for id,name,h,c in [('vase-sage','Sage ceramic vase',.28,'#8d9e8d'),('vase-terracotta','Terracotta bud vase',.20,'#b87959')]:
        add(id,name,'Decor',(.17,h,.17),[sphere((.17,h*.72,.17),(0,h*.36,0),c),cylinder((.08,h*.45,.08),(0,h*.775,0),c)],20)
    add('books','Stack of art books','Decor',(.28,.095,.22),[box((.28-i*.012,.03,.22),(i*.005,.015+i*.032,0),c) for i,c in enumerate(['#b47760','#d3c7a8','#6e8e8b'])],35)
    add('candle','Candle on tray','Decor',(.18,.19,.18),[cylinder((.18,.02,.18),(0,.01,0),'#b9986b'),cylinder((.09,.16,.09),(0,.10,0),CREAM),box((.004,.015,.004),(0,.187,0),INK)],12)
    add('storage-basket','Woven storage basket','Decor',(.38,.34,.30),[box((.38,.30,.30),(0,.15,0),'#ba9c6b'),box((.32,.012,.25),(0,.302,0),'#72614a'),*[box((.385,.012,.305),(0,y,0),'#d0b88b') for y in [.06,.12,.18,.24]]],30,mode='floor')
    add('desk-organizer','Desk organiser','Workspace accessories',(.24,.16,.13),[box((.24,.025,.13),(0,.0125,0),WOOD),*[box((.018,.16,.13),(x,.08,0),WOOD) for x in [-.11,0,.11]],box((.24,.16,.014),(0,.08,-.058),WOOD)],15)
    add('desk-mat','Felt desk mat','Workspace accessories',(.70,.006,.32),[box((.70,.006,.32),(0,.003,0),'#778980')],20)
    add('mug','Coffee mug','Decor',(.13,.10,.10),[cylinder((.09,.10,.09),(-.016,.05,0),'#c5a482'),cylinder((.075,.003,.075),(-.016,.100,0),'#584638'),box((.033,.055,.022),(.046,.052,0),'#c5a482')],10)
    for id,name,w,h,c in [('standing-desk','Standing desk · raised',1.4,1.10,WOOD),('standing-desk-seated','Standing desk · seated',1.4,.74,WOOD),('standing-desk-wide','Wide standing desk · raised',1.8,1.10,CREAM)]:
        add(id,name,'Workspace',(w,h,.7),desk(w,h,c),400,mode='floor',support=True,kind='Standing desk')
    for id,name,c,style in [('print-sunset','Sunset shapes · painting',('#926c52','#e9d6b8','#be7255','#d6a654'),'abstract'),('print-blue','Blue rhythm · painting',(INK,'#e0dfd3','#668a9e','#c09e78'),'abstract'),('poster-space','Lunar voyage · movie poster',(INK,'#25344b','#c4cfba','#d9986c'),'cinema'),('poster-noir','Midnight cinema · movie poster',(INK,'#d8cdb4','#5b7778','#293744'),'cinema'),('photo-landscape','Mountain memories · photo frame',(WOOD,'#c9d9d5','#919775','#566e69'),'photo'),('poster-gallery','Terracotta study · poster',(CREAM,'#e5cdb6','#b97457','#8d9574'),'abstract')]:
        add(id,name,'Wall art',(.50,.70,.04),art(.5,.7,c,style),30,mode='wall',kind='Movie poster' if style=='cinema' else 'Framed art')
    add('desktop-photo','Desktop photo frame','Decor',(.18,.24,.08),art(.18,.24,(WOOD,'#ccdad8','#dfb16b','#6f8878'),'photo')+[box((.08,.15,.03),(0,.075,-.025),WOOD)],12)
    for id,name,h,c,mode in [('ambient-bar','RGB ambient light bar',.45,'#9baed4','surface'),('floor-light-bar','RGB corner light',1.4,'#d0a3b8','floor')]:
        add(id,name,'Lighting',(.18,h,.18),[cylinder((.18,.018,.18),(0,.009,0),INK),box((.03,h-.02,.03),(0,h/2,0),c)],65,mode=mode,lighting=True)
    add('mushroom-lamp','Mushroom table lamp','Lighting',(.28,.31,.28),[cylinder((.09,.23,.09),(0,.115,0),'#cbaf84'),sphere((.28,.15,.28),(0,.235,0),'#edcf9c')],45,lighting=True)
    return result


def preview(product):
    # Orthographic projection of the same parts used by the room renderer.
    faces=[]
    def project(x,y,z): return (x*.9+z*.45,-y+z*.23-x*.12)
    for p in product['parts']:
        x,y,z=p['position']; w,h,d=p['size']; c=p['color']
        if p['shape']=='sphere':
            cx,cy=project(x,y,z)
            faces.append((z+y*.01, f'<ellipse cx="{cx}" cy="{cy}" rx="{w*.49}" ry="{h*.5}" fill="{c}"/>'))
        else:
            for indices,shade in [([(1,-1,1),(1,-1,-1),(1,1,-1),(1,1,1)],.82),([(-1,1,-1),(1,1,-1),(1,1,1),(-1,1,1)],1.08),([(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)],1)]:
                points=' '.join(','.join(str(round(v,5)) for v in project(x+a*w/2,y+b*h/2,z+e*d/2)) for a,b,e in indices)
                color='#'+''.join(f'{min(255,round(int(c[i:i+2],16)*shade)):02x}' for i in [1,3,5])
                faces.append((z+y*.01, f'<polygon points="{points}" fill="{color}"/>'))
    w,h,d=product['dimensions']; corners=[project(x,y,z) for x in [-w/2,w/2] for y in [0,h] for z in [-d/2,d/2]]
    lo=min(x for x,y in corners); top=min(y for x,y in corners); width=max(x for x,y in corners)-lo; height=max(y for x,y in corners)-top
    pad=max(width,height)*.12
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{lo-pad} {top-pad} {width+2*pad} {height+2*pad}"><title>{html.escape(product["name"])}</title>'+''.join(s for _,s in sorted(faces,key=lambda v:v[0]))+'</svg>\n'


def main():
    from backend.products import GeneratedProduct
    from scripts.build_home_props import home_products
    data=products()+home_products()
    target=ROOT/'frontend/public/previews/unbranded'
    target.mkdir(parents=True,exist_ok=True)
    for p in data:
        GeneratedProduct.model_validate(p)
        (target/f'{p["id"]}.svg').write_text(preview(p),encoding='utf-8')
    (ROOT/'data/unbranded.json').write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
    references=[]
    for width in [1.22,1.53,1.83]:
        for height,pose in [(.74,'seated'),(1.10,'standing')]:
            id=f'omnidesk-ascent-{round(width*100)}-{pose}'
            p=dict(id=id,name=f'Omnidesk Ascent {round(width*100)} · {pose}',category='Workspace',productType='Standing desk',
                   dimensions=[width,height,.76],price=870,priceNote='Illustrative budget allowance based on the page starting price, not a quote for this size. Simplified reference geometry; fixed planning height.',
                   placement=dict(mode='floor',canSupport=True),parts=desk(width,height,INK,.76))
            GeneratedProduct.model_validate(p)
            (target/f'{id}.svg').write_text(preview(p),encoding='utf-8')
            references.append(dict(geometry=p,metadata=dict(brand='Omnidesk',productUrl='https://theomnidesk.com/products/ascent',fetchedAt='2026-09-13',
                thumbnailUrl=f'/previews/unbranded/{id}.svg',features=['Standing desk','Cable management','Simplified model'],
                dimensionNote='Published tabletop footprint; selected fixed height within the published 63.7–127 cm range. Frame and tabletop thickness approximated.',
                sourceEvidence='Omnidesk Singapore Ascent official product page: 122/153/183 × 76 cm tabletops; 63.7–127 cm height range. Retrieved 2026-09-13.')))
    (ROOT/'data/brand-references.json').write_text(json.dumps(references,indent=2)+'\n',encoding='utf-8')
    print(f'Built {len(data)} original unbranded objects and previews.')


if __name__=='__main__':
    main()
