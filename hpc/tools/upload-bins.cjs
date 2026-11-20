// Upload farm-ng .bin files into an EXISTING dataset on a GEMINIbase stack and
// queue their extraction — the same calls the app's Files > Upload makes, but
// from a terminal with patient retries. Used to finish a browser batch that
// died part-way (a new browser upload would start a second dataset).
//
// usage: GEMI_EMAIL=.. GEMI_PASSWORD=.. node upload-bins.cjs <apiBase> <dir> <listFile> \
//          <objectPrefix> <experimentId> <datasetId>
//   listFile      one .bin filename per line (relative to <dir>)
//   objectPrefix  e.g. Raw/2026/EXP/SITE/POP/2026-09-17/Amiga/RGB/<shortId>/Images
const fs = require("fs")
const path = require("path")
const [base, dir, listFile, prefix, experimentId, datasetId] = process.argv.slice(2)
const CHUNK = 8 * 1024 * 1024
const PARTS = 4
const FILES = 3
const RETRY_S = [1, 3, 10, 30, 60, 60, 120, 300, 300]

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000))
const log = (m) => console.log(`${new Date().toTimeString().slice(0, 8)} ${m}`)
let token

async function call(label, fn) {
  for (let a = 0; ; a++) {
    let why
    try {
      const r = await fn()
      if (r.ok) return r
      why = `HTTP ${r.status} ${(await r.text()).slice(0, 200)}`
      // 4xx (other than timeout / rate limit) will not improve on a retry.
      if (r.status < 500 && r.status !== 408 && r.status !== 429) a = RETRY_S.length
    } catch (e) {
      why = e.cause?.code || e.message // network error
    }
    if (a >= RETRY_S.length) throw new Error(`${label}: ${why}`)
    log(`  retry ${label}: ${why}`)
    await sleep(RETRY_S[a])
  }
}
const auth = () => ({ Authorization: `Bearer ${token}` })
const json = (p, body) =>
  call(p, () => fetch(`${base}${p}`, { method: "POST", headers: { ...auth(), "Content-Type": "application/json" }, body: JSON.stringify(body) }))

async function uploadFile(name) {
  const file = path.join(dir, name)
  const size = fs.statSync(file).size
  const total = Math.max(1, Math.ceil(size / CHUNK))
  const id = `cli:${prefix}/${name}:${size}`
  const objectName = `${prefix}/${name}`
  const have = new Set(
    (await (await json("/api/files/check_uploaded_chunks", { file_identifier: id, total_chunks: total, object_name: objectName })).json())
      .uploaded_part_numbers ?? [],
  )
  const fd = fs.openSync(file, "r")
  let next = 0
  async function worker() {
    while (next < total) {
      const i = next++
      if (have.has(i + 1)) continue
      const len = Math.min(CHUNK, size - i * CHUNK)
      const buf = Buffer.alloc(len)
      fs.readSync(fd, buf, 0, len, i * CHUNK)
      await call(`${name} chunk ${i + 1}/${total}`, () => {
        const form = new FormData()
        form.append("file_chunk", new Blob([buf]), `part${i}`)
        form.append("chunk_index", String(i))
        form.append("total_chunks", String(total))
        form.append("file_identifier", id)
        form.append("object_name", objectName)
        form.append("experiment_id", experimentId)
        form.append("dataset_id", datasetId)
        return fetch(`${base}/api/files/upload_chunk`, { method: "POST", body: form, headers: auth() })
      })
    }
  }
  try {
    await Promise.all(Array.from({ length: PARTS }, worker))
  } finally {
    fs.closeSync(fd)
  }
  const job = await (
    await json("/api/jobs/submit", {
      job_type: "EXTRACT_BINARY",
      parameters: { files: [name], localDirPath: prefix, experiment_id: experimentId, dataset_id: datasetId },
      experiment_id: experimentId,
    })
  ).json()
  return { size, job: job.id }
}

;(async () => {
  const names = fs.readFileSync(listFile, "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  const lr = await call("login", () =>
    fetch(`${base}/api/users/login/access-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: process.env.GEMI_EMAIL, password: process.env.GEMI_PASSWORD }),
    }),
  )
  token = (await lr.json()).access_token
  log(`${names.length} file(s) -> ${prefix}`)
  const failed = []
  let cursor = 0
  let done = 0
  async function worker() {
    while (cursor < names.length) {
      const name = names[cursor++]
      try {
        const t = Date.now()
        const r = await uploadFile(name)
        done++
        log(`OK ${done}/${names.length} ${name} ${(r.size / 1048576).toFixed(0)} MB in ${((Date.now() - t) / 1000).toFixed(0)} s, job ${r.job}`)
      } catch (e) {
        failed.push(name)
        log(`FAILED ${name}: ${e.message}`)
      }
    }
  }
  await Promise.all(Array.from({ length: FILES }, worker))
  log(`finished: ${done} uploaded, ${failed.length} failed`)
  for (const f of failed) console.log(`FAILED_FILE ${f}`)
  process.exit(failed.length ? 1 : 0)
})().catch((e) => {
  console.error("FATAL", e.message)
  process.exit(2)
})
