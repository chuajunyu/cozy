import asyncio
import json

import pytest
from pydantic import ValidationError

from backend.catalog import BY_ID, search
from backend.design import DesignError
from backend.products import ROOT, GeneratedProduct
from backend.sessions import Session
from backend.tests.test_studio import add, edit


def test_unbranded_geometry_and_reference_provenance():
    records = json.loads((ROOT / 'data/unbranded.json').read_text())
    assert len(records) >= 40
    assert len({p['id'] for p in records}) == len(records)
    assert {'Electronics', 'Music', 'Wall art', 'Plants', 'Decor'} <= {p['category'] for p in records}
    for raw in records:
        GeneratedProduct.model_validate(raw)
        p = BY_ID['sample-' + raw['id']]
        assert p['readyForPreview'] and p['illustrative']
        assert (ROOT / 'frontend/public' / p['thumbnailUrl'].lstrip('/')).is_file()
        assert 'estimate' in p['priceNote']
    for width in [122, 153, 183]:
        p = BY_ID[f'reference-omnidesk-ascent-{width}-standing']
        assert p['width'] == width / 100 and p['depth'] == .76 and p['height'] == 1.1
        assert p['brand'] == 'Omnidesk' and p['illustrative']
        assert p['productUrl'] == 'https://theomnidesk.com/products/ascent'
    assert search(query='gaming monitor')[0]['productType'] == 'Monitor screen'


def test_wall_art_transactions_locks_undo_restore_and_openings():
    async def run():
        s = Session()
        id = 'sample-poster-space'
        await add(s, 'art', id, wallMount={'wall': 'north', 'offset': .5, 'height': 1.6})
        assert s.state.slots['art'].light is None
        from backend.design import DesignPatch, apply_patch
        patched = apply_patch(s.state, DesignPatch.model_validate({
            'baseRevision': s.state.revision, 'explanation': 'Move the artwork',
            'placements': [{'slotId':'art','catalogId':id,'x':0,'z':0,'rotation':0,'explanation':'Move artwork to south wall',
                            'wallMount':{'wall':'south','offset':.4,'height':1.8}}],
        }), s.products)
        assert patched.slots['art'].wallMount.wall == 'south'
        assert patched.slots['art'].light is None
        await edit(s, 'item.update', slotId='art', expectedProduct=id, wallMount={'wall':'west','offset':.25,'height':1.8})
        await edit(s, 'room.undo')
        assert s.state.slots['art'].wallMount.wall == 'north'
        before = s.state.model_dump(mode='json')
        with pytest.raises(DesignError):
            await edit(s, 'room.update', room={**s.state.room.model_dump(), 'windows':[{'wall':'north','offset':.5,'width':1.2,'height':1,'sill':1.1}]})
        assert s.state.model_dump(mode='json') == before
        restored = Session()
        await edit(restored, 'session.restore', backup={'version':3,'state':before,'products':[]})
        assert restored.state.slots['art'].wallMount.height == 1.6
        restored.state.slots['art'].locked = True
        with pytest.raises(DesignError):
            await edit(restored, 'item.update', slotId='art', expectedProduct=id, wallMount={'wall':'south','offset':.5,'height':1.6})
        with pytest.raises(DesignError):
            await edit(s, 'fixture.update', slotId='art', expectedProduct=id, light={'on':True,'brightness':1,'color':'#ffffff'})
    asyncio.run(run())


def test_electronics_follow_omnidesk_and_restore_support():
    async def run():
        s = Session()
        desk = 'reference-omnidesk-ascent-153-standing'
        await add(s, 'desk', desk)
        await add(s, 'screen', 'sample-monitor-27', supportId='desk', elevation=1.1)
        await edit(s, 'item.update', slotId='desk', expectedProduct=desk, x=.4)
        assert s.state.slots['screen'].x == .4
        assert s.state.slots['screen'].elevation == 1.1
        restored = Session()
        await edit(restored, 'session.restore', backup={'version':3,'state':s.state.model_dump(mode='json'),'products':[]})
        assert restored.state.slots['screen'].supportId == 'desk'
        await edit(s, 'room.undo')
        assert s.state.slots['screen'].x == 0
    asyncio.run(run())


def test_wall_art_cannot_claim_support_or_inconsistent_light_mount():
    raw = next(p for p in json.loads((ROOT / 'data/unbranded.json').read_text()) if p['id'] == 'poster-space')
    with pytest.raises(ValidationError):
        GeneratedProduct.model_validate({**raw, 'placement': {'mode':'wall','canSupport':True}})
    with pytest.raises(ValidationError):
        GeneratedProduct.model_validate({**raw, 'lighting': {'mount':'floor','colorMode':'fixed','dimmable':False,'evidence':'test'}})
