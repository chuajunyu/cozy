const fs = require('node:fs')
const ts = require('typescript')
const { test } = require('node:test')
const assert = require('node:assert/strict')

for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, filename) => {
  // Exercise the component's gesture callbacks without a DOM or a rendering loop.
  const originalRequire = module.require.bind(module)
  module.require = id => id === 'react' ? {
    useState: initial => [initial, () => {}], useRef: initial => ({ current: initial }),
  } : originalRequire(id)
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, filename)
}
const SunlightControls = require('../src/SunlightControls.tsx').default
function setup() {
  const saves = [], previews = []
  const tree = SunlightControls({ scene: { width: 4, depth: 3.5, items: [], sunHour: 9 }, catalog: [],
    mode: 'lighting', onChange: value => saves.push(value), onSunPreview: value => previews.push(value) })
  function find(node) {
    if (!node || typeof node !== 'object') return null
    if (node.props?.['aria-label'] === 'Time of day') return node.props
    return [node.props?.children].flat(Infinity).map(find).find(Boolean)
  }
  return { slider: find(tree), saves, previews }
}
test('sunlight drag previews every value and saves only the final value once', () => {
  const { slider, saves, previews } = setup()
  for (const value of ['10', '12', '16']) slider.onChange({ target: { value } })
  assert.equal(saves.length, 0)
  assert.deepEqual(previews, [10, 12, 16])
  slider.onPointerUp()
  slider.onLostPointerCapture()
  slider.onBlur()
  assert.equal(saves.length, 1)
  assert.equal(saves[0].sunHour, 16)
  assert.equal(previews.at(-1), null)
})
test('cancelled sunlight gestures never save; keyboard completion saves', () => {
  for (const cancel of [s => s.onPointerCancel(), s => s.onKeyDown({ key: 'Escape' }), s => s.onLostPointerCapture()]) {
    const { slider, saves, previews } = setup()
    slider.onChange({ target: { value: '15' } })
    cancel(slider)
    slider.onBlur()
    assert.equal(saves.length, 0)
    assert.equal(previews.at(-1), null)
  }
  const { slider, saves } = setup()
  slider.onChange({ target: { value: '9.5' } })
  slider.onKeyUp({ key: 'ArrowRight' })
  assert.equal(saves[0].sunHour, 9.5)
})
