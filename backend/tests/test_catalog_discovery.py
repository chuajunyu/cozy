import asyncio
import json

from backend.catalog import search
from backend.design_tools import execute_tool
from backend.sessions import Session


def product(id, **kwargs):
    return {'id': id, 'name': 'Chair', 'category': 'chair', 'price': 40, 'width': .5,
            'canRecommend': True, 'readyForPreview': True, **kwargs}


def test_relevance_uses_descriptive_fields_not_urls_ids_or_diagnostics():
    products = {p['id']: p for p in [product('oak-first', productUrl='https://oak.test', assetIssue='oak'),
                product('description', description='Oak frame'), product('material', material='oak'),
                product('name', name='Oak chair', features=['woven seat'])]}
    matches = search(query='oak', products=products)
    assert [p['id'] for p in matches] == ['material', 'name', 'description', 'oak-first']
    assert search(query='woven', products=products)[0]['id'] == 'name'
    assert search(query='OAK, oak!', products=products) == matches


def test_search_filters_and_empty_catalog_are_respected():
    values = [product('good'), product('unavailable', canRecommend=False), product('missing', readyForPreview=False),
              product('price', price=100), product('wide', width=2), product('wrong', category='bed')]
    assert [p['id'] for p in search(category='chair', max_price=50, max_width=1, products={p['id']: p for p in values})] == ['good']
    assert search(products={}) == []
    assert [p['id'] for p in search(products={'b': product('b'), 'a': product('a')})] == ['a', 'b']


def test_pagination_is_bounded_complete_and_validated():
    async def run():
        session = Session()
        session.custom_products = {f'test-{i:03}': product(f'test-{i:03}', category='test-only') for i in range(65)}
        ids = []
        offset = 0
        while True:
            result = await execute_tool(session, str(offset), 'search_catalog', json.dumps({'category': 'test-only', 'offset': offset}))
            assert result['ok'] and result['totalMatches'] == 65
            assert len(result['products']) <= 30
            ids.extend(p['id'] for p in result['products'])
            if 'nextOffset' not in result:
                break
            offset = result['nextOffset']
        assert ids == sorted(session.custom_products)
        for invalid in [-1, 1.5, True, '30', None]:
            result = await execute_tool(session, f'invalid-{invalid}', 'search_catalog', json.dumps({'offset': invalid}))
            assert result['code'] == 'invalid_arguments'
        result = await execute_tool(session, 'end', 'search_catalog', json.dumps({'category': 'test-only', 'offset': 99}))
        assert result['products'] == [] and 'nextOffset' not in result
    asyncio.run(run())
