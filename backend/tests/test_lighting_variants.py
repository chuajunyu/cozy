import asyncio
import json
from copy import deepcopy

import pytest
from backend.design import DesignError, LightSettings
from backend.design_tools import execute_tool
from backend.lighting import preset_settings, PROFILES
from backend.sessions import Session
from backend.studio import StudioCommand, handle_studio
from backend.tests.test_studio import add, edit
from backend.variants import VariantCommand, handle_variants, recover_variants, protected


def test_lighting_atomic_undo_duplicates_and_profiles():
    async def run():
        s = Session()
        await add(s, 'lamp', 'sample-demo-ceiling-fan')
        s.state.slots['lamp'].locked = True
        before = s.state.model_copy(deep=True)
        hour, fixtures = preset_settings(s.state, s.products, 'cozy')
        command = StudioCommand(type='lighting.apply', requestId='mood', baseRevision=s.state.revision, sunHour=hour, fixtures=fixtures)
        steps = len(s.history)
        await handle_studio(s, command)
        assert s.state.room.sunHour == 19 and s.state.slots['lamp'].locked
        assert len(s.history) == steps + 1
        await handle_studio(s, command)
        assert len(s.history) == steps + 1
        with pytest.raises(DesignError):
            await handle_studio(s, command.model_copy(update={'requestId': 'stale'}))
        saved = s.state.model_copy(deep=True)
        with pytest.raises(DesignError):
            await edit(s, 'lighting.apply', sunHour=12, fixtures={'missing': LightSettings()})
        assert s.state == saved
        await edit(s, 'room.undo')
        assert s.state.room == before.room and s.state.slots == before.slots
    asyncio.run(run())


@pytest.mark.parametrize('mode', ['fixed', 'white-spectrum', 'rgb', 'bulb-dependent'])
def test_preset_capabilities(mode):
    async def run():
        s = Session()
        await add(s, 'lamp', 'sample-demo-ceiling-fan')
        products = deepcopy(s.products)
        products[s.state.slots['lamp'].catalogId]['lighting']['colorMode'] = mode
        hour, fixtures = preset_settings(s.state, products, 'focus')
        assert hour == 10 and fixtures['lamp'].on
        assert fixtures['lamp'].color == ('#ffd3a0' if mode == 'fixed' else PROFILES['neutral']['color'])
        assert fixtures['lamp'].bulbProfile == ('neutral' if mode == 'bulb-dependent' else None)
        s.state.slots['lamp'].light = fixtures['lamp']
        hour, fixtures = preset_settings(s.state, products, 'daytime')
        assert hour == 12 and not fixtures['lamp'].on
        assert fixtures['lamp'].bulbProfile == s.state.slots['lamp'].light.bulbProfile
    asyncio.run(run())


def test_named_preset_needs_permission_and_noop_is_quiet():
    async def run():
        from backend.room_requests import explicit_permissions
        s = Session()
        args = {'requestId': 'mood', 'baseRevision': 0, 'preset': 'cozy'}
        denied = await execute_tool(s, 'denied', 'apply_lighting_preset', json.dumps(args))
        assert denied['code'] == 'architecture_permission'
        s.room_permissions['mood'] = explicit_permissions('Set the lighting to cozy evening')
        accepted = await execute_tool(s, 'allowed', 'apply_lighting_preset', json.dumps(args))
        assert accepted['ok'] and s.state.room.sunHour == 19
        assert not explicit_permissions('Make the room cozy')
        count = len(s.history)
        await edit(s, 'lighting.apply', sunHour=19)
        assert len(s.history) == count
    asyncio.run(run())


class VariantDesigner:
    active_count = 0
    maximum = 0
    sources = []
    fail_title = None

    def __init__(self, session):
        self.session = session
        self.active = True

    def submit(self, request_id, text):
        self.text = text

    async def run(self):
        s = self.session
        if s.planning:
            s.message('assistant', json.dumps({'directions': [{'title': title, 'rationale': f'{title} composition', 'palette': ['neutral']} for title in ['Calm', 'Contrast', 'Playful']]}))
        else:
            VariantDesigner.active_count += 1
            VariantDesigner.maximum = max(VariantDesigner.maximum, VariantDesigner.active_count)
            VariantDesigner.sources.append(s.state.model_dump())
            try:
                await asyncio.sleep(.02)
                direction = json.loads(self.text.split('Design direction:\n')[1])
                if direction['title'] == self.fail_title:
                    s.publish({'type': 'error', 'message': 'Simulated failure'})
                    return
                state = s.state.model_copy(deep=True)
                state.concept.title = direction['title']
                state.revision += 1
                s.accept(state)
            finally:
                VariantDesigner.active_count -= 1
        self.active = False
        s.publish({'type': 'design.completed', 'complete': True})
        await asyncio.Future()


async def finish(s):
    await s.variant_tasks['planner']
    await asyncio.gather(*(task for id, task in s.variant_tasks.items() if id != 'planner'), return_exceptions=True)


def test_variants_isolation_concurrency_adoption_and_recovery():
    async def run():
        s = Session()
        await add(s)
        s.state.slots['desk'].locked = True
        before = s.state.model_copy(deep=True)
        VariantDesigner.sources = []
        VariantDesigner.maximum = 0
        await handle_variants(s, VariantCommand(type='variants.generate', requestId='ideas', baseRevision=s.state.revision, text='A calm workspace'), VariantDesigner)
        await finish(s)
        assert s.state == before
        assert VariantDesigner.maximum == 2
        assert VariantDesigner.sources == [before.model_dump()] * 3
        data = s.variants
        assert all(c['status'] == 'ready' for c in data['candidates'])
        assert s.envelope()['variants'] == data
        restored = recover_variants(data, before, s.products)
        assert restored and not restored['outdated']
        assert all(c['status'] == 'ready' for c in restored['candidates'])
        count = len(s.history)
        command = VariantCommand(type='variants.adopt', requestId='choose', baseRevision=s.state.revision, setId=data['id'], candidateId=data['candidates'][1]['id'])
        await handle_variants(s, command, VariantDesigner)
        assert s.state.concept.title == 'Contrast' and s.state.slots['desk'].locked
        assert s.state.revision == before.revision + 1 and len(s.history) == count + 1
        await handle_variants(s, command, VariantDesigner)
        assert len(s.history) == count + 1
        assert s.previous_response_id is None and s.variants['outdated']
        await edit(s, 'room.undo')
        assert s.state.concept == before.concept
    asyncio.run(run())


def test_variants_failure_retry_staleness_and_interrupted_recovery():
    async def run():
        s = Session()
        await add(s)
        VariantDesigner.fail_title = 'Contrast'
        await handle_variants(s, VariantCommand(type='variants.generate', requestId='ideas', baseRevision=s.state.revision, text='Workspace'), VariantDesigner)
        await finish(s)
        data = s.variants
        candidate = data['candidates'][1]
        assert [c['status'] for c in data['candidates']] == ['ready', 'failed', 'ready']
        VariantDesigner.fail_title = None
        await handle_variants(s, VariantCommand(type='variants.retry', requestId='retry', baseRevision=s.state.revision, setId=data['id'], candidateId=candidate['id']), VariantDesigner)
        pending = recover_variants(data, s.state, s.products)
        assert pending['candidates'][1]['status'] == 'interrupted'
        await s.variant_tasks[candidate['id']]
        assert candidate['status'] == 'ready'
        await edit(s, 'item.update', slotId='desk', expectedProduct='sample-desk', rotation=90)
        assert data['outdated']
        with pytest.raises(DesignError):
            await handle_variants(s, VariantCommand(type='variants.adopt', requestId='stale', baseRevision=s.state.revision, setId=data['id'], candidateId=candidate['id']), VariantDesigner)
        assert recover_variants({'bad': 'data'}, s.state, s.products) is None
    asyncio.run(run())


def test_variant_protection_and_cancel_fence():
    async def run():
        s = Session()
        await add(s)
        source = s.state.model_copy(deep=True)
        changed = source.model_copy(deep=True)
        changed.room.floorColor = '#ffffff'
        with pytest.raises(DesignError):
            protected(source, changed, [])
        await handle_variants(s, VariantCommand(type='variants.generate', requestId='ideas', baseRevision=s.state.revision, text='Workspace'), VariantDesigner)
        await handle_variants(s, VariantCommand(type='variants.cancel', requestId='stop', baseRevision=s.state.revision, setId=s.variants['id']), VariantDesigner)
        await asyncio.gather(*s.variant_tasks.values(), return_exceptions=True)
        assert all(c['status'] == 'cancelled' for c in s.variants['candidates'])
        assert s.state == source
    asyncio.run(run())
