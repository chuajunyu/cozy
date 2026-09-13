import asyncio
import json

import pytest

from backend.design import DesignError
from backend.sessions import Session
from backend.tests.test_studio import edit


def test_full_height_windows_move_restore_and_undo():
    async def run():
        s = Session()
        window = {'wall': 'north', 'offset': .5, 'width': 3.2, 'height': 2.45, 'sill': .05}
        await edit(s, 'room.update', room={**s.state.room.model_dump(), 'windows': [window]})
        await edit(s, 'room.update', room={**s.state.room.model_dump(), 'windows': [{**window, 'wall': 'south', 'offset': .1}]})
        restored = Session()
        await edit(restored, 'session.restore', backup={'version': 3, 'state': json.loads(s.state.model_dump_json()), 'products': []})
        assert restored.state.room.windows[0].sill == .05
        assert restored.state.room.windows[0].wall == 'south'
        await edit(s, 'room.undo')
        assert s.state.room.windows[0].wall == 'north'
        before = s.state.model_dump()
        with pytest.raises(DesignError):
            await edit(s, 'room.update', room={**s.state.room.model_dump(), 'windows': [window, window]})
        assert s.state.model_dump() == before
    asyncio.run(run())
