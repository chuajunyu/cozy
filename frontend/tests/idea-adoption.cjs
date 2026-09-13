const fs = require('node:fs')
const ts = require('typescript')
const { test } = require('node:test')
const assert = require('node:assert/strict')
let hooks, index, effects
const react = {
  useRef(value) { return hooks[index++] ??= { current: value } },
  useState(value) {
    const i = index++
    if (!(i in hooks)) hooks[i] = value
    return [hooks[i], next => { hooks[i] = typeof next === 'function' ? next(hooks[i]) : next }]
  },
  useReducer(reducer, initial) {
    const [value, set] = this.useState(initial)
    return [value, action => set(old => reducer(old, action))]
  },
  useCallback(fn) { index++; return fn },
  useEffect(fn, deps) {
    const i = index++, old = hooks[i]
    if (!old || deps.some((d, j) => !Object.is(d, old.deps[j]))) {
      old?.cleanup?.()
      const record = hooks[i] = { deps }
      effects.push(() => { record.cleanup = fn() })
    }
  },
}
react.useReducer = react.useReducer.bind(react)
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => {
  const original = module.require.bind(module)
  module.require = id => id === 'react' ? react : original(id)
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, filename)
}
const { useConnection } = require('../src/useConnection.ts')
const VariantsPanel = require('../src/VariantsPanel.tsx').default
function setup() {
  hooks = []; effects = []
  let socket
  global.WebSocket = class {
    static OPEN = 1
    readyState = 1
    sent = []
    constructor() { socket = this }
    send(raw) { this.sent.push(JSON.parse(raw)) }
    close() {}
  }
  global.window = { location: { protocol: 'http:', host: 'localhost' } }
  global.localStorage = global.sessionStorage = { getItem: () => null, setItem() {} }
  function render() {
    index = 0
    const result = useConnection()
    const pending = effects.splice(0)
    pending.forEach(effect => effect())
    return result
  }
  render()
  return { render, get socket() { return socket }, event: payload => socket.onmessage({ data: JSON.stringify(payload) }),
    close: () => hooks.forEach(h => h?.cleanup?.()) }
}

test('adoption exits preview only on its own successful acknowledgment; the next edit is sent', () => {
  const h = setup()
  try {
    h.render().send({ type: 'variants.adopt', setId: 'set', candidateId: 'one' })
    const request = h.socket.sent.at(-1)
    assert.equal(h.render().adoptedIdea, null)
    h.event({ type: 'command.ack', requestId: 'unrelated' })
    assert.equal(h.render().adoptedIdea, null)
    h.event({ type: 'command.ack', requestId: request.requestId })
    assert.equal(h.render().adoptedIdea, request.requestId)
    assert.equal(h.render().pending, false)
    assert.equal(h.render().send({ type: 'item.update', slotId: 'desk', x: .5 }), true)
    assert.equal(h.socket.sent.at(-1).type, 'item.update')
  } finally { h.close() }
})

test('failed or disconnected adoption never reports success, including late acknowledgments', () => {
  for (const failure of ['error', 'disconnect']) {
    const h = setup()
    try {
      h.render().send({ type: 'variants.adopt', setId: 'set', candidateId: 'one' })
      const requestId = h.socket.sent.at(-1).requestId
      if (failure === 'error') h.event({ type: 'error', requestId, message: 'Locked piece' })
      else h.socket.onclose()
      h.event({ type: 'command.ack', requestId })
      assert.equal(h.render().adoptedIdea, null)
      assert.equal(h.render().pending, false)
    } finally { h.close() }
  }
})

test('Use this design sends adoption without prematurely dismissing the selected preview', () => {
  const sent = [], selected = []
  const tree = VariantsPanel({ variants: { id: 'set', outdated: true, candidates: [{ id: 'one', status: 'ready', direction: { title: 'Calm', palette: [] }, state: { total: 100 } }] },
    busy: false, disabled: false, selected: 'one', thumbnails: {}, warning: '', send: c => { sent.push(c); return true }, onSelect: id => selected.push(id) })
  function find(node) {
    if (node?.type === 'button' && node.props.children === 'Use this design') return node.props
    return [node?.props?.children].flat(Infinity).filter(Boolean).map(find).find(Boolean)
  }
  const button = find(tree)
  assert.equal(button.disabled, false)
  button.onClick()
  assert.equal(sent[0].type, 'variants.adopt')
  assert.deepEqual(selected, [])
})
