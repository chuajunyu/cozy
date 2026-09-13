"""Opt-in browser fixture: uvicorn backend.tests.browser_server:app (no API calls)."""

import asyncio
import json
import secrets
from contextlib import asynccontextmanager

from backend.design_tools import execute_tool
from backend.main import app, lifespan as real_lifespan


class SimulatedDesigner:
    def __init__(self, session):
        self.session = session
        self.active = True
        self.generation = session.generation
        self.inputs = asyncio.Queue()

    def submit(self, request_id, text, *, background=False):
        self.inputs.put_nowait((request_id, text, background))

    async def tool(self, name, args):
        result = await execute_tool(self.session, secrets.token_hex(8), name, json.dumps(args), self.generation)
        if not result['ok']:
            self.session.message('assistant', 'Simulation validation: ' + result['message'])
        return result

    async def run(self):
        s = self.session
        try:
            request, _, _ = await self.inputs.get()
            s.set_status('working', 'Simulated designer - no API calls')
            s.publish({'type': 'feedback.ack', 'requestId': request, 'stage': 'applied'})
            message = secrets.token_hex(8)
            for text in ['**Browser simulation.** ', 'I will place a sofa and rug as a coordinated group.']:
                s.delta(message, text)
                await asyncio.sleep(.3)
            if not s.state.slots:
                await self.tool('update_concept', {'baseRevision': s.state.revision,
                    'concept': {'title': 'A calm retreat', 'summary': 'A sofa with a soft rug.', 'palette': ['sand', 'oat'], 'materials': ['cotton']},
                    'slots': [{'id': id, 'label': id.title(), 'category': category, 'zone': 'Living', 'group': 'Relax', 'anchor': id == 'sofa'}
                              for id, category in [('sofa', 'sofa'), ('rug', 'rug')]]})
                await asyncio.sleep(1)
                await self.tool('apply_design_patch', {'baseRevision': s.state.revision,
                    'placements': [{'slotId': id, 'catalogId': product, 'x': 0, 'z': 0, 'rotation': 0, 'explanation': 'Simulation: coordinated neutral colors.'}
                                   for id, product in [('sofa', 'sofa-sand'), ('rug', 'rug-oat')]],
                    'explanation': 'The sofa and rug arrive together.'})
            # Leave time to exercise steering, dragging and undo in the real UI.
            while True:
                try:
                    request, _, background = await asyncio.wait_for(self.inputs.get(), timeout=15)
                except TimeoutError:
                    break
                s.publish({'type': 'feedback.ack', 'requestId': request, 'stage': 'applied'})
                if not background:
                    s.message('assistant', 'Simulation received your feedback and read the latest room.')
                placements = []
                for slot in s.state.slots.values():
                    if not slot.replacing or slot.locked:
                        continue
                    options = {'sofa': ['sofa-sand', 'sofa-sage'], 'rug': ['rug-oat', 'rug-olive']}.get(slot.category, [])
                    rejected = {r['catalogId'] for r in s.state.rejected.get(slot.id, [])}
                    product = next((p for p in options if p != slot.catalogId and p not in rejected), None)
                    if product:
                        placements.append({'slotId': slot.id, 'catalogId': product, 'x': slot.x, 'z': slot.z,
                            'rotation': slot.rotation, 'elevation': slot.elevation, 'explanation': 'Simulation: accepted alternative.'})
                if placements:
                    await self.tool('apply_design_patch', {'baseRevision': s.state.revision, 'placements': placements, 'explanation': 'Simulation replacement.'})
            s.set_status('complete', 'Simulation complete - no API calls')
        finally:
            self.active = False


@asynccontextmanager
async def simulation_lifespan(app):
    async with real_lifespan(app):
        app.state.designer_factory = SimulatedDesigner
        yield


app.router.lifespan_context = simulation_lifespan
