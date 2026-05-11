/**
 * PCA scatter (PC1 vs PC2) rendered from PLINK2's pca.eigenvec.
 *
 * Lives inside the GWAS job detail page. The file is small (one row
 * per sample × ~10 PC columns; ~30 KB for 300 samples) so we fetch
 * the whole thing once, parse client-side, and render with recharts.
 * Hover any dot to see the accession name — that's the main UX win
 * over the static PNG path (which the user can't ask "which dot is
 * sample X?").
 */
import { useEffect, useState } from "react"
import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { authHeaders } from "@/components/Common/PlotImage"
import { parsePcaEigenvec, type PcaTable } from "@/features/genotyping/lib/pcaEigenvec"

export interface PcaPlotProps {
  /**
   * Download URL of the PLINK pca.eigenvec artifact. Same auth path
   * as the Manhattan / QQ images.
   */
  src: string
}

interface PcaState {
  table: PcaTable | null
  error: string | null
  loading: boolean
}

export function PcaPlot({ src }: PcaPlotProps) {
  const [state, setState] = useState<PcaState>({
    table: null,
    error: null,
    loading: true,
  })

  useEffect(() => {
    if (!src) {
      setState({ table: null, error: "No PCA file", loading: false })
      return
    }
    let cancelled = false
    const base = (window as unknown as { __GEMI_BACKEND_URL__?: string })
      .__GEMI_BACKEND_URL__
    const url = base && !src.startsWith("http") ? `${base}${src}` : src

    setState({ table: null, error: null, loading: true })
    fetch(url, { headers: authHeaders() })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.text()
      })
      .then((text) => {
        if (cancelled) return
        const table = parsePcaEigenvec(text)
        setState({ table, error: null, loading: false })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setState({
          table: null,
          error: err instanceof Error ? err.message : "Failed to load PCA",
          loading: false,
        })
      })
    return () => {
      cancelled = true
    }
  }, [src])

  if (state.loading) {
    return (
      <p
        className="text-muted-foreground text-xs"
        data-testid="gwas-pca-loading"
      >
        Loading PCA…
      </p>
    )
  }
  if (state.error || !state.table) {
    return (
      <p className="text-xs text-red-600" data-testid="gwas-pca-error">
        {state.error ?? "PCA unavailable"}
      </p>
    )
  }
  if (state.table.points.length === 0 || state.table.nPcs < 2) {
    return (
      <p
        className="text-muted-foreground text-xs"
        data-testid="gwas-pca-empty"
      >
        PCA file has no plottable rows.
      </p>
    )
  }

  // recharts wants x/y as numeric fields on each datum; map PC1/PC2.
  const data = state.table.points.map((p) => ({
    sample: p.sample,
    pc1: p.pcs[0],
    pc2: p.pcs[1],
  }))

  return (
    <div
      className="bg-white rounded border"
      data-testid="gwas-pca-plot"
      style={{ height: 480 }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 12, right: 24, bottom: 36, left: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            type="number"
            dataKey="pc1"
            name="PC1"
            label={{ value: "PC1", position: "insideBottom", offset: -10 }}
            tickFormatter={(v: number) => v.toFixed(2)}
          />
          <YAxis
            type="number"
            dataKey="pc2"
            name="PC2"
            label={{ value: "PC2", angle: -90, position: "insideLeft" }}
            tickFormatter={(v: number) => v.toFixed(2)}
          />
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null
              const p = payload[0].payload as {
                sample: string
                pc1: number
                pc2: number
              }
              return (
                <div className="bg-popover text-popover-foreground border rounded px-2 py-1 text-xs shadow">
                  <div className="font-medium">{p.sample}</div>
                  <div className="text-muted-foreground font-mono">
                    PC1: {p.pc1.toFixed(4)}
                  </div>
                  <div className="text-muted-foreground font-mono">
                    PC2: {p.pc2.toFixed(4)}
                  </div>
                </div>
              )
            }}
          />
          <Scatter
            name="Samples"
            data={data}
            fill="#1f77b4"
            fillOpacity={0.7}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}
