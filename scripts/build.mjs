import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

// 1. Bundle all JS into one IIFE.
const js = execSync('npx -y esbuild js/main.js --bundle --format=iife --minify --charset=utf8', {
  cwd: root,
  maxBuffer: 64 * 1024 * 1024,
}).toString()

// 2. Inline the display fonts into the CSS as data URIs.
let css = read('css/styles.css')
for (const f of ['fraunces-600.woff2', 'fraunces-600-viet.woff2']) {
  const b64 = readFileSync(join(root, 'fonts', f)).toString('base64')
  css = css.replace(`url('../fonts/${f}')`, `url(data:font/woff2;base64,${b64})`)
}

// 3. Body markup from index.html, minus the module script tag.
const html = read('index.html')
const body = html
  .slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
  .replace(/\s*<script type="module"[^>]*><\/script>/, '')
const head = html.slice(html.indexOf('<head>') + 6, html.indexOf('</head>'))
  .replace(/\s*<link rel="stylesheet"[^>]*>/, '')

const fragment = `${head}
<style>
${css}
</style>
${body}
<script>
${js}
</script>
`

mkdirSync(join(root, 'dist'), { recursive: true })

// Artifact-ready fragment (no doctype/html/head/body — the host wraps it).
writeFileSync(join(root, 'dist/artifact.html'), fragment)

// Standalone file — double-click to run.
writeFileSync(join(root, 'dist/chews.html'), `<!doctype html>\n<html lang="en">\n<head>${head}</head>\n<body style="background:#15100e">\n${fragment.replace(head, '')}\n</body>\n</html>\n`)

console.log(`built dist/chews.html + dist/artifact.html (js ${(js.length / 1024).toFixed(0)}k, css ${(css.length / 1024).toFixed(0)}k)`)
