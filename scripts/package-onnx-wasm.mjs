import { copyFile, mkdir, readdir, rm } from 'node:fs/promises'
import path from 'node:path'

const runtimeDirectory = path.resolve('node_modules/onnxruntime-web/dist')
const outputDirectory = path.resolve('dist/onnx-runtime')
const runtimeFiles = [
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
]

await mkdir(outputDirectory, { recursive: true })
await Promise.all(runtimeFiles.map(file => copyFile(
  path.join(runtimeDirectory, file),
  path.join(outputDirectory, file),
)))

const assetsDirectory = path.resolve('dist/assets')
const generatedWasm = (await readdir(assetsDirectory)).filter(file => /^ort-wasm-.*\.wasm$/.test(file))
await Promise.all(generatedWasm.map(file => rm(path.join(assetsDirectory, file))))

console.log(`Packaged matching ONNX Runtime WASM and WebGPU files; removed ${generatedWasm.length} unused bundled WASM asset(s).`)
