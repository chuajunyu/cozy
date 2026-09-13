"""Append a bounded décor batch, preserving every previously curated record.

Run python -m scripts.expand_decor. IKEA models remain ignored local downloads.
"""
import concurrent.futures
import json
import re

from scripts.ingest_ikea import ROOT, fetch, ingest, save_catalogs

GROUPS = [
    ('artificial-plants-flowers-20492', 'Plants', 'Plant'),
    ('vases-10776', 'Decor', 'Vase'),
    ('plant-pots-10778', 'Plants', 'Plant pot'),
    ('candle-holders-candles-10760', 'Decor', 'Candle holder'),
    ('table-lamps-10732', 'Lighting', 'Lighting'),
    ('led-lights-20515', 'Lighting', 'Lighting'),
    ('frames-10786', 'Wall art', 'Picture frame'),
    ('pictures-posters-10787', 'Wall art', 'Decoration'),
    ('desk-accessories-10573', 'Workspace accessories', 'Desk accessory'),
]


def discover(group: tuple[str, str, str]) -> list[dict]:
    slug, category, kind = group
    source = f'https://www.ikea.com/sg/en/cat/{slug}/'
    page = fetch(source).decode('utf-8')
    urls = list(dict.fromkeys(re.findall(r'https://www\.ikea\.com/sg/en/p/[^"<>\\ ?]+', page)))
    existing = {p['productUrl'] for p in json.loads((ROOT / 'data/ikea-catalog.json').read_text(encoding='utf-8'))['products']}
    urls = [u for u in urls if u.split('#')[0] not in existing]
    return [{'url': u.split('#')[0], 'category': category, 'productType': kind,
             'discoveredFrom': source} for u in urls[:24]]


def main() -> None:
    path = ROOT / 'data/ikea-catalog.json'
    catalog = json.loads(path.read_text(encoding='utf-8'))
    products = {p['productUrl']: p for p in catalog['products']}
    entries_path = ROOT / 'data/ikea-urls.json'
    entries = {p['url']: p for p in json.loads(entries_path.read_text())}
    errors = catalog.get('errors', [])
    batch = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        tasks = {pool.submit(discover, group): group for group in GROUPS}
        for task in concurrent.futures.as_completed(tasks):
            try:
                for entry in task.result():
                    if entry['url'] not in products and entry['url'] not in {e['url'] for e in batch}:
                        batch.append(entry)
            except Exception as exc:
                print('Discovery unavailable:', tasks[task][0], str(exc), flush=True)
        print('New candidates:', len(batch), flush=True)
        tasks = {pool.submit(ingest, entry): entry for entry in batch}
        for task in concurrent.futures.as_completed(tasks):
            entry = tasks[task]
            try:
                product = task.result()
                products[entry['url']] = product
                entries[entry['url']] = entry
                print(product['name'], product['modelStatus'], product['missingFields'], flush=True)
            except Exception as exc:
                errors.append({'url': entry['url'], 'error': str(exc)})
            save_catalogs(list(products.values()), errors)
            entries_path.write_text(json.dumps(list(entries.values()), indent=2) + '\n')


if __name__ == '__main__':
    main()
