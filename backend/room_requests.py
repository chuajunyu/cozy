"""Conservative, server-owned grants derived only from the current user request."""

import re

WALLS = ['north', 'east', 'south', 'west']
DIRECTION = r'(?:north|east|south|west)'
VERBS = r'add|create|install|place|put|move|relocate|reposition|resize|widen|narrow|remove|delete|open|close|set|change|paint|repaint|recolor|recolour|color|colour|make|give|design|build|decorate|furnish|want'
PREFIX = r'(?:(?:please|can you|could you|would you|will you|i want you to)\s+)*'
NEGATIVE = r"\b(?:not|never|without|avoid|don't|dont|do not|shouldn't|cannot|can't|keep|preserve|leave)\b"
COLOR = r'(?:#[0-9a-f]{6}|blue|white|black|red|green|yellow|pink|purple|orange|brown|gray|grey|beige|cream|sage|sand|terracotta|charcoal|navy|teal|oak|walnut|slate|stone)'
SURFACE = r'(?<![-\w])(?:walls?|floors?)(?![-\w]|\s+(?:art|lamps?|lights?|shelves|shelf|decor|mounted|cushions?|rugs?))'


def explicit_permissions(text: str, slot_ids: list[str] | None = None) -> list[dict]:
    text = text.casefold().replace('’', "'").replace('-facing', '')
    # Keep noun lists ("north and east walls") together, but separate independent
    # instructions and prohibitions. Decimal measurements must remain intact.
    separator = rf'[,;!?\n]|(?<!\d)\.(?!\d)|\b(?:but|then)\b|\band\b(?=\s+(?:{PREFIX}(?:{VERBS})\b|do not\b|don\x27t\b|never\b|keep\b|leave\b|preserve\b))'
    permissions = []
    for clause in re.split(separator, text):
        clause = clause.strip()
        if not clause or re.search(NEGATIVE, clause):
            continue
        clause = re.sub(r'^i (?:would like|want)\b', 'want', clause)
        match = re.match(rf'{PREFIX}({VERBS})\b(.*)', clause)
        if not match:
            continue
        verb, rest = match.groups()
        surfaces = list(re.finditer(SURFACE, rest))
        paint_verb = verb in {'paint', 'repaint', 'recolor', 'recolour', 'color', 'colour'}
        desired = verb in {'give', 'design', 'build', 'create', 'decorate', 'furnish', 'want', 'make'}
        finish_actions = verb in {'set', 'change', 'make'}
        finish_targets = []
        for surface in surfaces:
            # Explicit paint requests need no predetermined color. Desired-room
            # phrases must attach a color to the surface, not just to furniture.
            start, end = surface.span()
            before, after = rest[:start], rest[end:]
            colored = bool(re.search(rf'{COLOR}\s+(?:{DIRECTION}\s+)?$', before) or
                           re.match(rf"\s+(?:(?:to|in|a|an|is|are|be|color|colour|of|the|shade)\s+)*(?:(?:light|dark|dusty|warm|soft|pale|deep)\s+)?{COLOR}\b", after))
            setting = bool(re.match(r'\s+(?:paint|colou?r|finish)\b', after) or
                           re.search(r'(?:paint|colou?r|finish)\s+(?:of\s+)?(?:the\s+)?$', before))
            if paint_verb or (desired and colored) or (finish_actions and (colored or setting)):
                finish_targets.append(surface)
        if finish_targets:
            wall_targets = [s for s in finish_targets if s.group().startswith('wall')]
            walls = []
            for target in wall_targets:
                named = re.search(rf'({DIRECTION}(?:\s+(?:and\s+)?{DIRECTION})*)\s*$', rest[:target.start()])
                walls.extend(re.findall(DIRECTION, named[1]) if named else WALLS if target.group() == 'walls' else [])
            permissions.append({'operation': 'room.finish', 'walls': list(dict.fromkeys(walls)),
                                'wallLimit': 4 if any(s.group() == 'walls' for s in wall_targets) or walls else 1,
                                'wallPaint': bool(wall_targets),
                                'floorPaint': any(s.group().startswith('floor') for s in finish_targets), 'dimensions': []})
            # A finish request cannot also grant architecture changes through a
            # location reference such as "paint the wall by the window".
            continue
        target = 'window' if re.search(r'\bwindows?\b', rest) else 'door' if re.search(r'\bdoors?\b', rest) else None
        action = 'add' if verb in {'add', 'create', 'install', 'place', 'put'} else 'remove' if verb in {'remove', 'delete'} else verb if verb in {'open', 'close'} else 'update'
        structural = verb in {'add', 'create', 'install', 'place', 'put', 'move', 'relocate', 'reposition', 'resize', 'widen', 'narrow', 'remove', 'delete', 'open', 'close', 'set', 'change'}
        operation = f'{target}.{action}' if target and structural else 'sun.set' if re.search(r'\bsun(?:light)?\b|\btime of day\b|\bsolar\b', rest) and verb in {'set', 'change'} else 'room.resize' if re.search(r'\broom\b', rest) and verb in {'resize', 'widen', 'narrow', 'set', 'change'} else None
        if operation is None or operation in {'window.open', 'window.close'}:
            continue
        walls = re.findall(rf'\b{DIRECTION}\b', rest)
        dimensions = re.findall(r'\b(width|depth|height)\b', rest)
        if operation == 'room.resize' and verb in {'set', 'change'} and not dimensions and not re.search(r'\b(size|dimensions)\b', rest):
            continue
        grant = {'operation': operation, 'walls': walls, 'dimensions': dimensions}
        if target and action == 'update':
            destination = re.search(rf'\b(?:to|onto)\s+(?:the\s+)?({DIRECTION})\b', rest)
            source = re.search(rf'\b({DIRECTION})\s+{target}\b', rest) or re.search(rf'\b{target}\s+(?:on|in)\s+(?:the\s+)?({DIRECTION})\b', rest)
            grant['walls'] = [source[1]] if source else []
            grant['targetWalls'] = [destination[1]] if destination else []
            grant['allowWallChange'] = bool(destination or re.search(r'\b(?:another|different) wall\b', rest))
            if target == 'window':
                grant['fields'] = (['wall', 'offset', 'sill'] if verb in {'move', 'relocate', 'reposition'} else
                                   dimensions or ['width'] if verb in {'widen', 'narrow'} else
                                   dimensions or ['width', 'height', 'sill'] if verb == 'resize' else
                                   ['wall', 'offset', 'width', 'height', 'sill'])
        if target == 'door' and slot_ids and action != 'add':
            grant['slotIds'] = list(slot_ids)
        if target and action in {'add', 'remove'} and len(walls) > 1:
            permissions.extend({**grant, 'walls': [wall]} for wall in dict.fromkeys(walls))
        else:
            permissions.append(grant)
    return permissions
