import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

const runtimeDirectory = path.resolve('node_modules/onnxruntime-web/dist')
const outputDirectory = path.resolve('dist/onnx-runtime')
const runtimeFiles = ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']

await mkdir(outputDirectory, { recursive: true })
await Promise.all(runtimeFiles.map(file => copyFile(
  path.join(runtimeDirectory, file),
  path.join(outputDirectory, file),
)))

console.log(`Copied the matching ONNX Runtime WASM files to ${outputDirectory}.`)
