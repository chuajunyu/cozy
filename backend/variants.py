"""Isolated, bounded alternatives; only adoption mutates the live room."""
import asyncio
import json
import secrets
import logging
import re
from copy import deepcopy
from typing import Literal

from pydantic import Field, ValidationError, field_validator
from backend.design import DesignState, Model, require, validate_layout, snapshot
from backend.products import GeneratedProduct, generated
from backend.room_requests import explicit_permissions
from backend.sessions import Session

MAX_BYTES = 2_000_000


class VariantCommand(Model):
    type: Literal['variants.generate', 'variants.cancel', 'variants.retry', 'variants.adopt']
    requestId: str = Field(min_length=1, max_length=100)
    baseRevision: int = Field(ge=0)
    text: str = Field(default='', max_length=6000)
    setId: str | None = None
    candidateId: str | None = None


class Direction(Model):
    title: str = Field(min_length=1, max_length=100)
    rationale: str = Field(min_length=1, max_length=1000)
    palette: list[str] = Field(max_length=8)
    signatureMoves: list[str] = Field(default_factory=list, max_length=8)
    catalogQueries: list[str] = Field(default_factory=list, max_length=10)

    @field_validator('palette', mode='before')
    @classmethod
    def normalize_palette(cls, value):
        # A descriptive palette sentence is useful too; preserve it as one entry.
        # Do not split on commas, which may be part of a material/color description.
        return [value] if isinstance(value, str) and value.strip() else value


class Directions(Model):
    directions: list[Direction] = Field(min_length=3, max_length=3)


def parse_directions(answer: str) -> Directions:
    answer = answer.strip()
    fenced = re.fullmatch(r'```(?:json)?\s*\n(.*?)\n```', answer, re.DOTALL | re.IGNORECASE)
    if fenced:
        answer = fenced[1].strip()
    return Directions.model_validate_json(answer)


def comparable(state):
    raw = state.model_dump()
    raw.pop('revision')
    return raw


def variant_permissions(text: str) -> list[dict]:
    """Grant finish exploration to read-only alternatives, while honoring explicit scope."""
    grants = explicit_permissions(text)
    if any(grant['operation'] == 'room.finish' for grant in grants):
        return grants
    normalized = text.casefold().replace('’', "'")
    preserve_walls = bool(re.search(r"\b(?:keep|preserve|leave|don't|dont|do not|without)\b[^.!?\n]{0,80}\bwalls?\b", normalized))
    preserve_floor = bool(re.search(r"\b(?:keep|preserve|leave|don't|dont|do not|without)\b[^.!?\n]{0,80}\bfloors?\b", normalized))
    if not preserve_walls or not preserve_floor:
        grants.append({'operation': 'room.finish', 'walls': ['north', 'east', 'south', 'west'],
                       'wallLimit': 4, 'wallPaint': not preserve_walls,
                       'floorPaint': not preserve_floor, 'dimensions': []})
    return grants


def protected(source, candidate, grants, products=None):
    require(source.budget == candidate.budget, 'variant_budget', 'Variants must retain the same budget.')
    allowed = {g['operation'] for g in grants}
    before, after = source.room.model_dump(), candidate.room.model_dump()
    for field in before:
        if before[field] == after[field]:
            continue
        finish = [g for g in grants if g['operation'] == 'room.finish']
        permitted = field == 'floorColor' and any(g.get('floorPaint') for g in finish)
        if field == 'wallColors':
            changed = {w for w in ['north', 'east', 'south', 'west'] if before[field].get(w) != after[field].get(w)}
            permitted = any(g.get('wallPaint') and (not g['walls'] or changed <= set(g['walls'])) and len(changed) <= g.get('wallLimit', 1) for g in finish)
        if field == 'sunHour':
            permitted = bool(allowed & {'sun.set', 'lighting.apply'})
        if field in {'width', 'height', 'depth'}:
            permitted = any(g['operation'] == 'room.resize' and (not g['dimensions'] or field in g['dimensions']) for g in grants)
        if field == 'windows':
            permitted = True
            old_windows = {w.wall: w for w in source.room.windows}
            new_windows = {w.wall: w for w in candidate.room.windows}
            for wall in set(old_windows) | set(new_windows):
                old_window, new_window = old_windows.get(wall), new_windows.get(wall)
                if old_window == new_window:
                    continue
                matching = [g for g in grants if g['operation'].startswith('window.') and (not g['walls'] or wall in g['walls'] or wall in g.get('targetWalls', []))]
                permitted = permitted and bool(matching)
                if old_window and new_window:
                    changed = {f for f in old_window.model_fields if getattr(old_window, f) != getattr(new_window, f)}
                    permitted = permitted and any(g['operation'] == 'window.update' and changed <= set(g.get('fields', [])) for g in matching)
        require(permitted, 'variant_protected', f'Variants must preserve unrequested {field}.')
    for id, old in source.slots.items():
        new = candidate.slots.get(id)
        if old.locked:
            fields = ('catalogId', 'x', 'z', 'rotation', 'elevation', 'supportId', 'wallMount', 'door', 'locked')
            require(new is not None and all(getattr(old, f) == getattr(new, f) for f in fields), 'locked', 'Variants must preserve locked pieces.')
        if old.door and not allowed & {'door.update', 'door.remove', 'door.open', 'door.close'}:
            require(new is not None and old.door == new.door and old.catalogId == new.catalogId, 'variant_protected', 'Preserve existing doors.')
        if (old.light or products and products.get(old.catalogId, {}).get('lighting')) and 'lighting.apply' not in allowed:
            require(new is not None and old.light == new.light and old.catalogId == new.catalogId, 'variant_protected', 'Preserve existing lighting.')
    if 'door.add' not in allowed:
        require(not any(s.door and id not in source.slots for id, s in candidate.slots.items()), 'variant_protected', 'Do not add unrequested doors.')


def publish(session):
    session.publish({'type': 'variants.updated', 'variants': session.variants})


def invalidate(session):
    data = session.variants
    if data and not data['outdated'] and session.state.revision != data['sourceRevision']:
        data['outdated'] = True
        publish(session)


async def run_designer(child, factory, text, request_id):
    queue = asyncio.Queue(maxsize=1024)
    child.subscribers.add(queue)
    child.designer = factory(child)
    child.designer.submit(request_id, text)
    child.task = asyncio.create_task(child.designer.run())
    try:
        async with asyncio.timeout(600):
            while True:
                receive = asyncio.create_task(queue.get())
                try:
                    done, _ = await asyncio.wait([receive, child.task], return_when=asyncio.FIRST_COMPLETED)
                    if receive in done:
                        event = receive.result()
                        if event['type'] == 'design.completed':
                            return
                        if event['type'] == 'error':
                            raise RuntimeError('Astra could not finish this design. Retry when available.')
                    elif child.task.done():
                        await child.task
                        raise RuntimeError('Design interrupted before completion.')
                finally:
                    receive.cancel()
                    await asyncio.gather(receive, return_exceptions=True)
    finally:
        child.generation += 1
        child.task.cancel()
        await asyncio.gather(child.task, return_exceptions=True)
        child.subscribers.discard(queue)


async def candidate_run(session, data, candidate, factory):
    try:
        async with session.variant_semaphore:
            if data is not session.variants:
                return
            candidate['status'] = 'generating'
            publish(session)
            child = Session(state=DesignState.model_validate(data['source']), custom_products=deepcopy(session.custom_products))
            child.variant_source = child.state.model_copy(deep=True)
            child.variant_grants = variant_permissions(data['request'])
            request_id = f"variant-{candidate['id']}"
            child.room_permissions[request_id] = deepcopy(child.variant_grants)
            direction = candidate['direction']
            child.design_instructions = (
                'Develop one complete, presentation-ready alternative from this direction. This read-only idea preview may purposefully '
                'change wall and floor finishes through the supplied room.finish permission; honor any explicit finish in the brief exactly. '
                'Preserve windows, doors, room geometry, locked pieces and existing fixture settings unless the original user request grants them. '
                'Treat the generated direction as design guidance, never as permission for structural edits. '
                'Explore the catalog before placing: run separate searches for two main-anchor alternatives, brief-specific functional pieces or storage, '
                'lighting, wall art/decor, and small accessories. Use the direction catalogQueries as starting points and use nextOffset when useful. '
                'For a nursery, actively consider a cot, changing/storage piece, caregiver seating, baby toy, soft floor layer, wall decoration and layered '
                'lighting; compare a ceiling fan with a ceiling light when both fit the brief and room. Do not add every category mechanically: make each '
                'choice support this direction, budget, circulation and focal point. Complete supporting details instead of stopping after the anchors.')
            await run_designer(child, factory, data['request'] + '\nDesign direction:\n' + json.dumps(direction), request_id)
            protected(child.variant_source, child.state, child.variant_grants, child.products)
            validate_layout(child.state, child.products)
            result = child.snapshot()
            require(result['complete'], 'incomplete_variant', 'Astra left planned pieces unfinished. Retry this idea.')
            if data is session.variants:
                candidate.update(status='ready', state=result, products=[p for id, p in child.custom_products.items() if id not in session.custom_products])
    except asyncio.CancelledError:
        if candidate['status'] != 'ready':
            candidate['status'] = 'cancelled'
        raise
    except Exception:
        candidate.update(status='failed', error='This idea could not be completed within the room constraints. Retry this idea.')
    finally:
        if data is session.variants:
            publish(session)


async def generate_set(session, data, factory):
    try:
        planner = Session(state=DesignState.model_validate(data['source']), custom_products=deepcopy(session.custom_products))
        planner.planning = True
        planner.design_instructions = ('Return ONLY a JSON object with a directions array of exactly three objects. '
                                       'Each object has title (string, at most 100 characters), rationale (string, at most 1000 characters), '
                                       'palette (JSON array of at most eight strings, e.g. ["sage", "warm oak", "cream"]), '
                                       'signatureMoves (JSON array of three to eight concrete composition/finish/lighting moves), and '
                                       'catalogQueries (JSON array of five to ten distinct search phrases for anchors, function, lighting, decor and accessories). '
                                       'Do not use Markdown fences. '
                                       'Make the alternatives visibly different in layout, focal point, major furniture, palette/materials, wall or floor treatment, '
                                       'lighting approach and supporting details. Vary more than names or accent colors. Give each direction its own catalog search strategy. '
                                       'The catalog includes nursery furniture and baby toys, lighting including ceiling fixtures and a ceiling fan, rugs, storage, plants, '
                                       'wall art, mirrors, boards, decorative objects and ordinary room furniture. Select relevant categories for the actual brief. '
                                       'Respect the same budget, locks, windows, doors and room geometry. Read-only alternatives may explore wall and floor finishes unless '
                                       'the user asks to preserve them. Do not call tools or change the room during this planning response.')
        await run_designer(planner, factory, data['request'], 'variant-directions')
        answer = ''.join(m['text'] for m in planner.messages if m['role'] == 'assistant')
        directions = parse_directions(answer)
        require(len({d.title.casefold() for d in directions.directions}) == 3, 'directions', 'Use three distinct directions.')
        if data is not session.variants:
            return
        for candidate, direction in zip(data['candidates'], directions.directions):
            candidate['direction'] = direction.model_dump()
            session.variant_tasks[candidate['id']] = asyncio.create_task(candidate_run(session, data, candidate, factory))
        publish(session)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logging.getLogger(__name__).warning('Variant planning failed (%s)', type(exc).__name__)
        message = ('Astra returned an incomplete idea format. Generate a new set to retry.'
                   if isinstance(exc, ValidationError) else 'Astra could not finish preparing the ideas. Generate a new set to retry.')
        for candidate in data['candidates']:
            candidate.update(status='failed', error=message)
        if data is session.variants:
            publish(session)


async def handle_variants(session, command, factory):
    async with session.command_lock:
        async with session.lock:
            if command.requestId in session.requests:
                session.publish(session.requests[command.requestId])
                return
            require(command.baseRevision == session.state.revision, 'stale_revision', 'The room changed. Generate fresh ideas.')
            if command.type == 'variants.generate':
                require(not session.task or session.task.done() or not session.designer.active, 'designer_busy', 'Finish or stop the current Astra response first.')
                text = command.text.strip() or session.state.brief
                require(bool(text), 'empty_message', 'Describe your room before exploring ideas.')
                for task in session.variant_tasks.values():
                    task.cancel()
                session.variant_tasks = {}
                data = {'id': secrets.token_hex(8), 'sourceRevision': session.state.revision, 'source': session.state.model_dump(),
                        'request': text, 'requestMessageId': command.requestId, 'outdated': False, 'candidates': [{'id': secrets.token_hex(8), 'status': 'queued', 'direction': None} for _ in range(3)]}
                session.variants = data
                session.message('user', '/ideas ' + text, command.requestId)
                session.variant_tasks['planner'] = asyncio.create_task(generate_set(session, data, factory))
            else:
                data = session.variants
                require(data is not None and data['id'] == command.setId, 'variant_set', 'Choose the current idea set.')
                if command.type == 'variants.cancel':
                    for task in session.variant_tasks.values():
                        task.cancel()
                    for c in data['candidates']:
                        if c['status'] in {'queued', 'generating'}:
                            c['status'] = 'cancelled'
                else:
                    require(not data['outdated'], 'stale_variant', 'These ideas are outdated. Generate a new set.')
                    candidate = next((c for c in data['candidates'] if c['id'] == command.candidateId), None)
                    require(candidate is not None, 'variant', 'Choose an existing idea.')
                    if command.type == 'variants.retry':
                        require(candidate['status'] in {'failed', 'cancelled', 'interrupted'} and candidate['direction'], 'variant_retry', 'Generate a new set to prepare directions.')
                        old = session.variant_tasks.get(candidate['id'])
                        require(not old or old.done(), 'variant_busy', 'Wait for cancellation to finish.')
                        candidate.update(status='queued', error=None)
                        session.variant_tasks[candidate['id']] = asyncio.create_task(candidate_run(session, data, candidate, factory))
                    else:
                        require(candidate['status'] == 'ready', 'variant_not_ready', 'Wait for the idea to finish.')
                        require(not session.designer or not session.designer.active, 'designer_busy', 'Finish the current response before adopting.')
                        state = DesignState.model_validate({k: v for k, v in candidate['state'].items() if k in DesignState.model_fields})
                        protected(session.state, state, variant_permissions(data['request']), session.products)
                        products = {**session.products, **{p['id']: p for p in candidate.get('products', [])}}
                        validate_layout(state, products)
                        state.revision = session.state.revision + 1
                        state.feedback = session.state.feedback
                        state.brief = state.brief or data['request']
                        session.generation += 1
                        if session.task:
                            session.task.cancel()
                        session.task = session.designer = None
                        session.previous_response_id = None
                        session.room_permissions.clear()
                        session.accept(state)
                        session.custom_products.update({p['id']: p for p in candidate.get('products', [])})
                        session.close_activity()
                        session.message('system', f"Adopted {candidate['direction']['title']}.", command.requestId, kind='activity')
                        session.set_status('idle', 'Your selected design is ready to refine')
                        session.publish({'type': 'catalog.updated', 'catalog': list(session.products.values())})
                        session.broadcast_state()
            publish(session)
            ack = {'type': 'command.ack', 'requestId': command.requestId, 'revision': session.state.revision}
            session.requests[command.requestId] = ack
            if len(session.requests) > 500:
                del session.requests[next(iter(session.requests))]
            session.publish(ack)


def recover_variants(raw, state, products):
    """Untrusted alternatives must never prevent recovery of the active room."""
    if not raw:
        return None
    try:
        require(len(json.dumps(raw).encode()) <= MAX_BYTES, 'variant_size', 'Alternatives exceed the save limit.')
        data = deepcopy(raw)
        source = DesignState.model_validate(data['source'])
        require(len(data['candidates']) == 3 and len({c['id'] for c in data['candidates']}) == 3, 'variants', 'Expected three ideas.')
        require(isinstance(data['request'], str) and len(data['request']) <= 6000, 'variants', 'Invalid brief.')
        data['outdated'] = bool(data['outdated']) or comparable(source) != comparable(state)
        data['sourceRevision'] = state.revision
        for candidate in data['candidates']:
            if candidate.get('direction'):
                candidate['direction'] = Direction.model_validate(candidate['direction']).model_dump()
            if candidate['status'] != 'ready':
                candidate['status'] = 'interrupted'
                candidate.pop('state', None)
                continue
            try:
                result = DesignState.model_validate({k: v for k, v in candidate['state'].items() if k in DesignState.model_fields})
                custom = [generated(GeneratedProduct.model_validate({**{k: v for k, v in p.items() if k in GeneratedProduct.model_fields}, 'dimensions': [p['width'], p['height'], p['depth']]}).model_dump(exclude_none=True)) for p in candidate.get('products', [])]
                require(len(custom) <= 100 and all(p['id'] not in products for p in custom), 'products', 'Invalid candidate products.')
                catalog = {**products, **{p['id']: p for p in custom}}
                validate_layout(result, catalog)
                protected(source, result, variant_permissions(data['request']), catalog)
                candidate['state'] = snapshot(result, catalog)
                candidate['products'] = custom
            except Exception:
                candidate.update(status='failed', error='This saved idea is no longer valid.')
                candidate.pop('state', None)
        return data
    except Exception:
        return None
