"""Centered, quarter-turn support geometry shared by every room transaction."""

import math
import re

from backend.design import require

EPS = .005


def mode(p):
    return p.get('placement', {}).get('mode', p.get('lighting', {}).get('mount', 'floor'))


def supports(p, child):
    deck = p.get('placement', {}).get('support')
    if child.get('placement', {}).get('surfaceKind') == 'mattress':
        return bool(deck and child['width'] <= deck['width'] + .01 and child['depth'] <= deck['depth'] + .01)
    if deck or p['floorLayer'] or p.get('lighting') or mode(p) in {'ceiling', 'wall'}:
        return False
    explicit = p.get('placement', {}).get('canSupport')
    if explicit is not None:
        return explicit
    return p['category'] in {'desk', 'coffee_table', 'side_table', 'dining_table', 'shelf', 'dresser', 'wardrobe'}


def support_pose(s, p):
    deck = p.get('placement', {}).get('support', {})
    dx, dz = deck.get('center', [0, 0])
    angle = math.radians(s.rotation)
    return (s.x + dx * math.cos(angle) + dz * math.sin(angle),
            s.z - dx * math.sin(angle) + dz * math.cos(angle),
            s.elevation + deck.get('height', p['height']))


def bounds(s, p, deck=False):
    data = p.get('placement', {}).get('support', {}) if deck else {}
    x, z, _ = support_pose(s, p) if deck else (s.x, s.z, s.elevation)
    w, d = data.get('width', p['width']), data.get('depth', p['depth'])
    if s.rotation % 180:
        w, d = d, w
    return x - w / 2, x + w / 2, z - d / 2, z + d / 2


def overlap(a, b):
    return a[0] < b[1] - EPS and a[1] > b[0] + EPS and a[2] < b[3] - EPS and a[3] > b[2] + EPS


def contains(a, b):
    return a[0] <= b[0] + EPS and a[1] >= b[1] - EPS and a[2] <= b[2] + EPS and a[3] >= b[3] - EPS


def valid_support(child, parent, products):
    if not child.catalogId or not parent.catalogId or child.id == parent.id:
        return False
    p, q = products.get(child.catalogId), products.get(parent.catalogId)
    if not p or not q:
        return False
    return (mode(p) == 'surface' and supports(q, p)
            and abs(child.elevation - support_pose(parent, q)[2]) <= EPS
            and contains(bounds(parent, q, True), bounds(child, p)))


def inferred_support(s, state, products):
    if s.supportId and s.supportId in state.slots and valid_support(s, state.slots[s.supportId], products):
        return state.slots[s.supportId]
    return next((p for p in state.slots.values() if valid_support(s, p, products)), None)


def opening(room, wall, offset, width, height, bottom=0):
    length = room.width if wall in {'north', 'south'} else room.depth
    start = .2 + (length - width - .4) * offset
    return (start, start + width, bottom, bottom + height)


def normalize_door(s, p, room):
    require(s.door is not None, 'door_anchor', 'A door needs a wall anchor.')
    a, b, _, _ = opening(room, s.door.wall, s.door.offset, p['width'], p['height'])
    center = (a + b) / 2
    wall = s.door.wall
    s.x = -room.width / 2 if wall == 'west' else room.width / 2 if wall == 'east' else center - room.width / 2
    s.z = -room.depth / 2 if wall == 'north' else room.depth / 2 if wall == 'south' else room.depth / 2 - center
    s.rotation = 0 if wall in {'north', 'south'} else 90
    s.elevation, s.supportId = 0, None


def validate_architecture(state, products):
    from backend.wall_fixtures import validate
    validate(state, products)
    room = state.room
    require(len({w.wall for w in room.windows}) == len(room.windows), 'windows', 'Use at most one window per wall.')
    for w in room.windows:
        length = room.width if w.wall in {'north', 'south'} else room.depth
        require(w.width <= length - .4 + EPS and w.sill + w.height <= room.height - .1 + EPS,
                'windows', 'Window dimensions must fit the room wall.')
    doors = []
    for s in state.slots.values():
        p = products.get(s.catalogId)
        if not p:
            continue
        if not p.get('door'):
            require(s.door is None, 'door_anchor', 'Only doors can have wall anchors.')
            continue
        require(s.door is not None, 'door_anchor', 'A door needs a wall anchor.')
        normal = s.model_copy(deep=True)
        normalize_door(normal, p, room)
        require(pose(normal) == pose(s), 'door_anchor', 'Door position must match its wall anchor.')
        w = s.door.wall
        length = room.width if w in {'north', 'south'} else room.depth
        require(p['width'] <= length - .4 and p['height'] <= room.height - .1 + EPS, 'door_bounds', 'Door dimensions must fit the room.')
        a, b, bottom, top = opening(room, w, s.door.offset, p['width'], p['height'])
        for win in room.windows:
            if win.wall == w:
                c, d, low, high = opening(room, w, win.offset, win.width, win.height, win.sill)
                require(not (a < d + .12 and b > c - .12 and bottom < high + .12 and top > low - .12), 'door_window', 'Keep doors clear of windows.')
        if w in {'north', 'south'}:
            clearance = (a-room.width/2, b-room.width/2, -room.depth/2 if w == 'north' else room.depth/2-p['width'], -room.depth/2+p['width'] if w == 'north' else room.depth/2)
        else:
            clearance = (-room.width/2 if w == 'west' else room.width/2-p['width'], -room.width/2+p['width'] if w == 'west' else room.width/2, room.depth/2-b, room.depth/2-a)
        for old, old_opening, old_clearance in doors:
            require(not overlap(clearance, old_clearance), 'door_swing', 'Door swings must remain clear of each other.')
            require(not (old.door.wall == w and a < old_opening[1]+.12 and b > old_opening[0]-.12), 'door_swing', 'Leave space between door frames.')
        for other in state.slots.values():
            q = products.get(other.catalogId)
            if q and not q.get('door') and not q['floorLayer'] and other.elevation < top-EPS:
                require(not overlap(clearance, bounds(other, q)), 'door_swing', 'Leave the full inward door swing clear.')
        doors.append((s, (a,b), clearance))


def pose(s):
    return s.catalogId, round(s.x, 8), round(s.z, 8), s.rotation, round(s.elevation, 8)


def validate_supports(state, products):
    for s in state.slots.values():
        p = products.get(s.catalogId)
        if not p:
            continue
        seen, current = {s.id}, s
        while current.supportId:
            require(current.supportId not in seen, 'support_cycle', 'Items cannot support each other in a loop.')
            seen.add(current.supportId)
            parent = state.slots.get(current.supportId)
            require(parent is not None and valid_support(current, parent, products), 'support_fit', 'The selected support must fit the entire object.')
            current = parent
        if mode(p) not in {'ceiling', 'wall'} and s.elevation > EPS:
            require(mode(p) == 'surface' and inferred_support(s, state, products) is not None,
                    'unsupported', 'Elevated furniture needs a verified supporting surface.')


def settle_state(candidate, previous, products, *, migration=False, allow_locked=()):
    """Resolve support trees, then check every vertical sweep and final relationship."""
    state = candidate.model_copy(deep=True)
    original = candidate.slots
    resolved, processing = {}, set()
    for old in previous.slots.values():
        require(not old.locked or old.id in original, 'locked', f'{old.id} is locked.')

    def resolve(id):
        if id in resolved:
            return resolved[id]
        require(id not in processing, 'support_cycle', 'Items cannot support each other in a loop.')
        s = state.slots[id]
        if not s.catalogId:
            resolved[id] = s
            return s
        p = products.get(s.catalogId)
        require(p is not None, 'unknown_product', f'Unknown product {s.catalogId}.')
        processing.add(id)
        old = previous.slots.get(id)
        from backend.wall_fixtures import is_wall_fixture, normalize
        if is_wall_fixture(p):
            require(not s.supportId and not s.door, 'wall_mount', 'Wall lights cannot attach to furniture or doors.')
            normalize(s, p, state.room)
        elif p.get('door'):
            normalize_door(s, p, state.room)
        else:
            parent = inferred_support(old, previous, products) if old and old.catalogId in products else None
            # A replacement of a support carries children, while an explicit move detaches.
            if parent and pose(old) == pose(original[id]) and original[id].supportId == old.supportId:
                if parent.id in original:
                    moved = resolve(parent.id)
                    angle = math.radians(moved.rotation - parent.rotation)
                    dx, dz = old.x-parent.x, old.z-parent.z
                    s.x = moved.x + dx*math.cos(angle) + dz*math.sin(angle)
                    s.z = moved.z - dx*math.sin(angle) + dz*math.cos(angle)
                    s.rotation = (old.rotation + moved.rotation - parent.rotation) % 360
                    s.elevation = old.elevation + support_pose(moved, products[moved.catalogId])[2] - support_pose(parent, products[parent.catalogId])[2]
                    s.supportId = moved.id
                else:
                    s.supportId = None
            if s.supportId:
                require(s.supportId in original, 'support_missing', 'The supporting item no longer exists.')
                parent = resolve(s.supportId)
                require(supports(products[parent.catalogId], p), 'support_fit', 'This surface cannot support the selected product.')
            start = s.elevation
            require(start + p['height'] <= state.room.height + EPS, 'too_tall', f'{id} exceeds room height.')
            landing, support_id = (start, None) if mode(p) in {'ceiling','wall'} else (0, None)
            if mode(p) == 'surface':
                for other in list(resolved.values()):
                    if other.catalogId and other.id != id and supports(products[other.catalogId], p):
                        top = support_pose(other, products[other.catalogId])[2]
                        if top <= start+EPS and top > landing and contains(bounds(other, products[other.catalogId], True), bounds(s,p)):
                            landing, support_id = top, other.id
            if s.supportId:
                require(support_id == s.supportId, 'support_fit', 'The whole object must fit its selected supporting surface.')
            for other in resolved.values():
                if not other.catalogId or other.id == support_id:
                    continue
                q = products[other.catalogId]
                if q.get('door') or p['floorLayer'] != q['floorLayer']:
                    continue
                if other.elevation < start+p['height']-EPS and other.elevation+q['height'] > landing+EPS:
                    require(not overlap(bounds(s,p),bounds(other,q)), 'overlap', f'{id} overlaps {other.id} or its fall path.')
            s.elevation, s.supportId = landing, support_id
        if old and old.locked and (pose(old) != pose(s) or old.wallMount != s.wallMount):
            require(migration and id in allow_locked, 'locked', f'{id} is locked; explicitly allow its migration adjustment.')
        resolved[id] = s
        processing.remove(id)
        return s

    order = sorted(state.slots, key=lambda id: (mode(products.get(state.slots[id].catalogId, {})) == 'surface', state.slots[id].elevation))
    for id in order:
        resolve(id)
    validate_architecture(state, products)
    return state


def alternative_kind(p):
    if p.get('door'):
        return 'door'
    if p.get('lighting'):
        return p['lighting']['mount'] + ' light'
    if p.get('placement', {}).get('surfaceKind') == 'mattress':
        return 'mattress'
    category = p.get('collection', p['category'])
    for text in [(p.get('productType') or '').strip().lower(), p['name'].strip().lower()]:
        if re.search(r'\b(sofa|sofas|loveseat|couch)\b', text):
            return 'sofa'
        if re.search(r'\b(bed frame|bedframe|day[ -]?bed)\b', text):
            return 'bed'
        bedding = re.search(r'\bmattress (pad|protector|topper)s?\b', text)
        if bedding:
            return 'mattress ' + bedding[1]
        if re.search(r'\bmattress(?:es)?\b', text):
            return 'mattress'
        if re.search(r'\b(armchair|wing chair|lounge chair|easy chair)\b', text):
            return 'armchair'
        if re.search(r'\bchair\b', text):
            if re.search(r'\b(office|gaming|desk|swivel)\b', text) or category == 'Workspace':
                return 'office chair'
            return 'dining chair' if re.search(r'\bdining\b', text) or category == 'Dining' else 'chair'
        for pattern, kind in [(r'\b(bedside|nightstand)\b','bedside table'), (r'\bbed\b','bed'), (r'\bwardrobe\b','wardrobe'), (r'\b(drawers|dresser)\b','chest of drawers'), (r'\b(bookcase|shelf|shelving)\b','bookcase'), (r'\bdesk\b','desk'), (r'\b(coffee|side)\b.*\btable\b','coffee / side table')]:
            if re.search(pattern, text):
                return kind
        if re.search(r'\bdining table\b', text) or (re.search(r'\btable\b', text) and category == 'Dining'):
            return 'dining table'
        if re.search(r'\btable\b', text):
            return 'table'
        if re.search(r'\b(rug|carpet|floor mat)\b', text):
            return 'rug'
    return (p.get('productType') or p['name']).strip().lower()
