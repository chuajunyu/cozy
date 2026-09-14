const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename)
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { deliveryReducer: reduce, deliveryLabel } = require('../src/delivery.ts')
const { wallVisible } = require('../src/wallVisibility.ts')

const track = (requestId, owner = requestId, kind = 'chat', stage = 'sending') => ({ type: 'track', requestId, owner, kind, stage })
const ack = (requestId, stage) => ({ type: 'ack', requestId, stage })

test('manual acknowledgments and unrelated errors do not overwrite chat receipts', () => {
  let state = reduce({}, track('chat'))
  state = reduce(state, ack('chat', 'sent'))
  assert.equal(reduce(state, ack('manual', 'applied')), state)
  assert.equal(reduce(state, { type: 'error', requestId: 'manual' }), state)
  assert.equal(reduce(state, { type: 'error' }), state)
  assert.equal(deliveryLabel(state.chat), 'Sent to Astra')
  state = reduce(state, track('second'))
  state = reduce(state, ack('chat', 'applied'))
  assert.equal(deliveryLabel(state.chat), 'Received by Astra')
  assert.equal(state.second.stage, 'sending')
})

test('a burst receipt refers only to its latest edit and ignores late acknowledgments', () => {
  let state = reduce({}, track('rotate-1', 'burst', 'activity', 'received'))
  state = reduce(state, ack('rotate-1', 'applied'))
  state = reduce(state, track('rotate-2', 'burst', 'activity', 'received'))
  assert.equal(state['rotate-1'], undefined)
  assert.equal(state['rotate-2'].stage, 'received')
  assert.equal(reduce(state, ack('rotate-1', 'applied')), state)
  state = reduce(state, ack('rotate-2', 'queued'))
  state = reduce(state, ack('rotate-2', 'applied'))
  assert.equal(reduce(state, ack('rotate-2', 'sent')), state)
  assert.equal(state['rotate-2'].stage, 'applied')
})

test('idle edits are saved, failures stay failed and recovery clears transient receipts', () => {
  let state = reduce({}, track('manual', 'burst', 'activity', 'saved'))
  assert.equal(deliveryLabel(state.manual), 'Saved to room')
  state = reduce(state, track('chat'))
  state = reduce(state, { type: 'disconnect' })
  assert.equal(state.manual.stage, 'saved')
  assert.equal(state.chat.stage, 'uncertain')
  state = reduce(state, ack('chat', 'queued'))
  assert.equal(state.chat.stage, 'queued')
  state = reduce(state, { type: 'error', requestId: 'chat' })
  assert.equal(reduce(state, ack('chat', 'applied')), state)
  assert.equal(state.chat.stage, 'failed')
  assert.deepEqual(reduce(state, { type: 'reset' }), {})
})

test('an unsent debounce batch becomes saved when Astra finishes', () => {
  let state = reduce({}, track('first', 'burst', 'activity', 'received'))
  state = reduce(state, track('latest', 'burst', 'activity', 'received'))
  state = reduce(state, ack('first', 'saved'))
  assert.equal(state.latest.stage, 'received')
  state = reduce(state, ack('latest', 'saved'))
  assert.equal(deliveryLabel(state.latest), 'Saved to room')
  assert.equal(reduce(state, ack('latest', 'sent')), state)
  assert.equal(reduce(state, { type: 'disconnect' }).latest.stage, 'saved')
})

test('delivery tracking is bounded and duplicate message delivery retains its stage', () => {
  let state = {}
  for (let i = 0; i < 100; i++) state = reduce(state, track(String(i)))
  assert.equal(Object.keys(state).length, 50)
  assert.equal(state['0'], undefined)
  state = reduce(state, ack('99', 'applied'))
  assert.equal(reduce(state, track('99')), state)
  assert.equal(reduce(state, ack('99', 'invalid')), state)
})

test('cutaways expose the interior in every camera quadrant', () => {
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    assert.equal(wallVisible('east', x, z, false), x > 0)
    assert.equal(wallVisible('west', x, z, false), x < 0)
    assert.equal(wallVisible('south', x, z, false), z > 0)
    assert.equal(wallVisible('north', x, z, false), z < 0)
  }
})

test('wall visibility is stable edge-on, hides in top view and resets on exit', () => {
  assert.equal(wallVisible('east', .01, 1, false, false), false)
  assert.equal(wallVisible('east', -.01, 1, false, true), true)
  assert.equal(wallVisible('east', .1, 1, false, false), true)
  assert.equal(wallVisible('east', -.1, 1, false, true), false)
  for (const wall of ['north', 'east', 'south', 'west']) assert.equal(wallVisible(wall, -1, -1, true, true), false)
  assert.equal(wallVisible('north', 0, -1, false), true)
  assert.equal(wallVisible('south', 0, -1, false), false)
  assert.equal(wallVisible('east', 1, 0, false), true)
  assert.equal(wallVisible('west', 1, 0, false), false)
  assert.equal(wallVisible('east', 0, 0, false, true), true)
})
