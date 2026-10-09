/**
 * AgentText — renders the agent's replies. Models answer in light Markdown
 * (tables, bold, headings, lists, `code`); this shows just that subset,
 * built as React elements (never as HTML), so nothing the model writes can
 * inject markup.
 */
import type { ReactNode } from "react"

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let last = 0
  let n = 0
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0
    if (i > last) out.push(text.slice(last, i))
    const tok = m[0]
    out.push(
      tok.startsWith("**") ? (
        <strong key={`${key}-${n}`}>{tok.slice(2, -2)}</strong>
      ) : (
        <code
          key={`${key}-${n}`}
          className="bg-muted rounded px-1 py-0.5 font-mono text-[0.85em]"
        >
          {tok.slice(1, -1)}
        </code>
      ),
    )
    n += 1
    last = i + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim())

const isRule = (line: string) =>
  /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line)

export function AgentText({ text }: { text: string }) {
  const lines = text.split("\n")
  const blocks: ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const key = `b${i}`
    if (line.includes("|") && i + 1 < lines.length && isRule(lines[i + 1])) {
      const head = cells(line)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && lines[i].includes("|")) {
        rows.push(cells(lines[i]))
        i += 1
      }
      blocks.push(
        <div key={key} className="my-2 overflow-x-auto">
          <table className="border-collapse text-sm">
            <thead>
              <tr>
                {head.map((h, c) => (
                  <th
                    // biome-ignore lint/suspicious/noArrayIndexKey: static table
                    key={c}
                    className="border-b px-2 py-1 text-left font-medium"
                  >
                    {inline(h, `${key}h${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static table
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td
                      // biome-ignore lint/suspicious/noArrayIndexKey: static table
                      key={ci}
                      className="border-b border-dashed px-2 py-1 align-top"
                    >
                      {inline(c, `${key}r${ri}c${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      blocks.push(
        <p key={key} className="mt-3 mb-1 font-semibold">
          {inline(heading[2], key)}
        </p>,
      )
    } else if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const indent = (line.match(/^\s*/)?.[0].length ?? 0) > 1
      blocks.push(
        <div key={key} className={`flex gap-2 ${indent ? "ml-5" : ""}`}>
          <span className="text-muted-foreground">
            {/^\s*\d+\./.test(line) ? line.trim().split(".")[0] + "." : "•"}
          </span>
          <span>{inline(line.replace(/^\s*([-*]|\d+\.)\s+/, ""), key)}</span>
        </div>,
      )
    } else if (line.trim() === "") {
      blocks.push(<div key={key} className="h-2" />)
    } else {
      blocks.push(<p key={key}>{inline(line, key)}</p>)
    }
    i += 1
  }
  return <div className="min-w-0 leading-relaxed">{blocks}</div>
}
