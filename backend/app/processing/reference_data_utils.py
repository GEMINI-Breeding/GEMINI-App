"""
Utilities for parsing Reference Data uploads (CSV / Excel) and matching
ReferencePlots against existing PlotRecords in a workspace.

Parse flow:
  1. read_reference_file()   — load file into a list of row dicts
  2. apply_column_mapping()  — rename columns per user-supplied mapping, drop ignored cols
  3. extract_plots()         — split each row into identity fields + numeric traits dict
  4. match_plots()           — compare against PlotRecords in the workspace, return MatchReport
"""

import io
import csv
from typing import Any

import pandas as pd
from sqlmodel import Session, select

from app.models.plot_record import PlotRecord
from app.models.reference_data import MatchReport, ReferencePlot


# ---------------------------------------------------------------------------
# File parsing
# ---------------------------------------------------------------------------

def read_reference_file(content: bytes, filename: str) -> list[dict[str, Any]]:
    """
    Parse a CSV or Excel file and return a list of row dicts.
    All values are kept as-is (strings for CSV, native types for Excel).
    Raises ValueError for unsupported formats or empty files.
    """
    lower = filename.lower()
    if lower.endswith(".csv"):
        text = content.decode("utf-8-sig")  # handle BOM
        reader = csv.DictReader(io.StringIO(text))
        rows = list(reader)
    elif lower.endswith((".xlsx", ".xls")):
        buf = io.BytesIO(content)
        df = pd.read_excel(buf, dtype=str)  # read all as str to avoid type surprises
        df = df.where(pd.notna(df), None)   # replace NaN with None
        rows = df.to_dict(orient="records")
    else:
        raise ValueError(f"Unsupported file format: {filename}. Use .csv, .xlsx, or .xls")

    if not rows:
        raise ValueError("File is empty or has no data rows.")

    return rows


def get_file_headers(content: bytes, filename: str) -> list[str]:
    """Return just the column headers from the file, for the mapping UI."""
    rows = read_reference_file(content, filename)
    if not rows:
        return []
    return list(rows[0].keys())


# ---------------------------------------------------------------------------
# Column mapping
# ---------------------------------------------------------------------------

# Reserved canonical field names that are NOT trait columns
_IDENTITY_FIELDS = {"plot_id", "col", "row", "accession"}
_IGNORE = "__ignore__"


def apply_column_mapping(
    rows: list[dict[str, Any]],
    column_mapping: dict[str, str],
) -> list[dict[str, str]]:
    """
    Rename file columns according to column_mapping.

    column_mapping format: { original_col_name: canonical_name }
    Canonical names: "plot_id" | "col" | "row" | "accession" | "<trait_name>" | "__ignore__"

    Columns absent from the mapping are ignored.
    Returns a new list of row dicts with only mapped columns (excluding ignored).
    """
    mapped_rows = []
    for row in rows:
        new_row: dict[str, str] = {}
        for orig_col, canonical in column_mapping.items():
            if canonical == _IGNORE:
                continue
            val = row.get(orig_col)
            new_row[canonical] = str(val).strip() if val is not None else ""
        mapped_rows.append(new_row)
    return mapped_rows


def validate_column_mapping(column_mapping: dict[str, str]) -> None:
    """
    Raise ValueError if the mapping is missing required identity fields.
    Either 'plot_id' must be mapped, or both 'col' and 'row' must be mapped.
    """
    canonical_values = set(column_mapping.values()) - {_IGNORE}
    has_plot_id = "plot_id" in canonical_values
    has_col_row = "col" in canonical_values and "row" in canonical_values
    if not has_plot_id and not has_col_row:
        raise ValueError(
            "Column mapping must assign at least 'plot_id', or both 'col' and 'row'."
        )


def infer_trait_columns(column_mapping: dict[str, str]) -> list[str]:
    """Return the trait column names from a mapping (non-identity, non-ignore values)."""
    return [
        v for v in column_mapping.values()
        if v != _IGNORE and v not in _IDENTITY_FIELDS
    ]


# ---------------------------------------------------------------------------
# Plot extraction
# ---------------------------------------------------------------------------

def extract_plots(
    mapped_rows: list[dict[str, str]],
    trait_columns: list[str],
) -> list[ReferencePlot]:
    """
    Convert mapped rows into ReferencePlot objects (without dataset_id set yet).
    Non-numeric trait values are silently skipped.
    plot_id defaults to f"{col}-{row}" when plot_id is not mapped.
    """
    plots: list[ReferencePlot] = []
    for row in mapped_rows:
        plot_id = row.get("plot_id", "").strip()
        col = row.get("col", "").strip() or None
        row_val = row.get("row", "").strip() or None

        # Derive plot_id from col+row when not explicitly mapped
        if not plot_id:
            if col and row_val:
                plot_id = f"{col}-{row_val}"
            else:
                continue  # skip rows with no identity

        traits: dict[str, float] = {}
        for trait in trait_columns:
            raw = row.get(trait, "")
            if raw is None or str(raw).strip() == "":
                continue
            try:
                traits[trait] = float(raw)
            except (ValueError, TypeError):
                pass  # skip non-numeric values

        plots.append(ReferencePlot(
            plot_id=plot_id,
            col=col,
            row=row_val,
            accession=row.get("accession", "").strip() or None,
            traits=traits if traits else None,
        ))
    return plots


# ---------------------------------------------------------------------------
# Plot matching
# ---------------------------------------------------------------------------

def match_plots(
    session: Session,
    workspace_id: str,
    experiment: str,
    location: str,
    population: str,
    reference_plots: list[ReferencePlot],
) -> MatchReport:
    """
    Compare reference_plots against PlotRecords in the workspace with the same
    experiment/location/population. Returns a MatchReport.

    Matching logic:
      - Primary: plot_id == PlotRecord.plot_id
      - Fallback (when plot_id looks like "col-row"): col == col AND row == row
    """
    # Fetch all PlotRecord identities for this workspace / experiment / location / population
    db_plots = session.exec(
        select(PlotRecord.plot_id, PlotRecord.col, PlotRecord.row).where(
            PlotRecord.workspace_id == workspace_id,
            PlotRecord.experiment == experiment,
            PlotRecord.location == location,
            PlotRecord.population == population,
        )
    ).all()

    known_plot_ids: set[str] = {p.plot_id for p in db_plots if p.plot_id}
    known_col_row: set[tuple[str, str]] = {
        (p.col, p.row) for p in db_plots if p.col and p.row
    }

    matched = 0
    unmatched_plots: list[dict[str, str]] = []

    for ref in reference_plots:
        hit = False
        if ref.plot_id in known_plot_ids:
            hit = True
        elif ref.col and ref.row and (ref.col, ref.row) in known_col_row:
            hit = True

        if hit:
            matched += 1
        else:
            unmatched_plots.append({
                "plot_id": ref.plot_id,
                "col": ref.col or "",
                "row": ref.row or "",
            })

    return MatchReport(
        total=len(reference_plots),
        matched=matched,
        unmatched=len(unmatched_plots),
        unmatched_plots=unmatched_plots,
    )
