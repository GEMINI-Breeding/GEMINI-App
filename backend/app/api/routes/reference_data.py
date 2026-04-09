"""
Reference Data API routes.

Global resource (upload / list / delete):
  POST   /reference-data/upload
  GET    /reference-data/
  GET    /reference-data/{dataset_id}
  GET    /reference-data/{dataset_id}/plots
  DELETE /reference-data/{dataset_id}

Workspace association:
  GET    /workspaces/{workspace_id}/reference-data/
  POST   /workspaces/{workspace_id}/reference-data/{dataset_id}
  DELETE /workspaces/{workspace_id}/reference-data/{dataset_id}
  GET    /workspaces/{workspace_id}/reference-data/match
"""

import json
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Query, UploadFile
from sqlmodel import select

from app.api.deps import CurrentUser, SessionDep
from app.models.reference_data import (
    MatchReport,
    ReferenceDataset,
    ReferenceDatasetPublic,
    ReferenceDatasetWithMatch,
    ReferencePlot,
    ReferencePlotPublic,
    ReferencePlotsPublic,
    WorkspaceReferenceDataset,
)
from app.models.workspace import Workspace
from app.processing.reference_data_utils import (
    apply_column_mapping,
    extract_plots,
    infer_trait_columns,
    match_plots,
    read_reference_file,
    validate_column_mapping,
)

# ---------------------------------------------------------------------------
# Global router (prefix set in main.py)
# ---------------------------------------------------------------------------

router = APIRouter(prefix="/reference-data", tags=["reference-data"])


@router.post("/parse-headers")
async def parse_headers(
    *,
    current_user: CurrentUser,
    file: UploadFile,
) -> dict[str, list[str]]:
    """Return the column headers from a CSV or Excel file without persisting anything."""
    content = await file.read()
    filename = file.filename or "upload"
    try:
        rows = read_reference_file(content, filename)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    headers = list(rows[0].keys()) if rows else []
    return {"headers": headers}


@router.post("/upload", response_model=ReferenceDatasetWithMatch)
async def upload_reference_data(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    file: UploadFile,
    name: str = Query(..., description="Required dataset name"),
    experiment: str = Query(default=""),
    location: str = Query(default=""),
    population: str = Query(default=""),
    date: str = Query(default=""),
    column_mapping_json: str = Query(
        ..., description="JSON string: { original_col: canonical_name }"
    ),
) -> Any:
    """
    Upload a CSV or Excel file as a Reference Dataset.

    Steps:
      1. Parse the file
      2. Apply column mapping
      3. Validate mapping (requires plot_id or col+row)
      4. Extract ReferencePlot rows
      5. Persist ReferenceDataset + ReferencePlots
    """
    content = await file.read()
    filename = file.filename or "upload"

    try:
        column_mapping: dict[str, str] = json.loads(column_mapping_json)
    except json.JSONDecodeError:
        raise HTTPException(status_code=422, detail="column_mapping_json is not valid JSON")

    try:
        validate_column_mapping(column_mapping)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    try:
        raw_rows = read_reference_file(content, filename)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    mapped_rows = apply_column_mapping(raw_rows, column_mapping)
    trait_cols = infer_trait_columns(column_mapping)
    plots = extract_plots(mapped_rows, trait_cols)

    if not plots:
        raise HTTPException(
            status_code=422,
            detail="No valid plot rows found after applying column mapping.",
        )

    dataset = ReferenceDataset(
        name=name,
        experiment=experiment,
        location=location,
        population=population,
        date=date,
        column_mapping=column_mapping,
        plot_count=len(plots),
        trait_columns=trait_cols,
    )
    session.add(dataset)
    session.flush()  # get dataset.id before inserting plots

    for plot in plots:
        plot.dataset_id = dataset.id
        session.add(plot)

    session.commit()
    session.refresh(dataset)

    return ReferenceDatasetWithMatch(
        **ReferenceDatasetPublic.model_validate(dataset).model_dump(),
        match_report=None,  # match is workspace-scoped; run via association endpoint
    )


@router.get("/", response_model=list[ReferenceDatasetPublic])
def list_datasets(
    session: SessionDep,
    current_user: CurrentUser,
    experiment: str | None = Query(default=None),
    location: str | None = Query(default=None),
    population: str | None = Query(default=None),
) -> Any:
    """List all uploaded ReferenceDatasets, optionally filtered by experiment/location/population."""
    stmt = select(ReferenceDataset)
    if experiment:
        stmt = stmt.where(ReferenceDataset.experiment == experiment)
    if location:
        stmt = stmt.where(ReferenceDataset.location == location)
    if population:
        stmt = stmt.where(ReferenceDataset.population == population)
    datasets = session.exec(stmt.order_by(ReferenceDataset.created_at.desc())).all()
    return [ReferenceDatasetPublic.model_validate(d) for d in datasets]


@router.get("/{dataset_id}", response_model=ReferenceDatasetPublic)
def get_dataset(
    session: SessionDep,
    current_user: CurrentUser,
    dataset_id: uuid.UUID,
) -> Any:
    dataset = session.get(ReferenceDataset, dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Reference dataset not found")
    return ReferenceDatasetPublic.model_validate(dataset)


@router.get("/{dataset_id}/plots", response_model=ReferencePlotsPublic)
def list_plots(
    session: SessionDep,
    current_user: CurrentUser,
    dataset_id: uuid.UUID,
    skip: int = 0,
    limit: int = 500,
) -> Any:
    dataset = session.get(ReferenceDataset, dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Reference dataset not found")
    plots = session.exec(
        select(ReferencePlot)
        .where(ReferencePlot.dataset_id == dataset_id)
        .offset(skip)
        .limit(limit)
    ).all()
    return ReferencePlotsPublic(
        data=[ReferencePlotPublic.model_validate(p) for p in plots],
        count=len(plots),
    )


@router.delete("/{dataset_id}")
def delete_dataset(
    session: SessionDep,
    current_user: CurrentUser,
    dataset_id: uuid.UUID,
) -> dict[str, str]:
    dataset = session.get(ReferenceDataset, dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Reference dataset not found")
    session.delete(dataset)
    session.commit()
    return {"message": "Reference dataset deleted"}


# ---------------------------------------------------------------------------
# Workspace-scoped router (included into workspaces router in main.py)
# ---------------------------------------------------------------------------

workspace_ref_router = APIRouter(
    prefix="/workspaces/{workspace_id}/reference-data",
    tags=["reference-data"],
)


def _get_workspace(session: SessionDep, workspace_id: uuid.UUID) -> Workspace:
    ws = session.get(Workspace, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return ws


def _compute_match_report(
    session: SessionDep,
    workspace_id: uuid.UUID,
    dataset: ReferenceDataset,
) -> MatchReport:
    plots = session.exec(
        select(ReferencePlot).where(ReferencePlot.dataset_id == dataset.id)
    ).all()
    return match_plots(
        session=session,
        workspace_id=str(workspace_id),
        experiment=dataset.experiment,
        location=dataset.location,
        population=dataset.population,
        reference_plots=list(plots),
    )


@workspace_ref_router.get("/", response_model=list[ReferenceDatasetWithMatch])
def list_workspace_datasets(
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: uuid.UUID,
) -> Any:
    """List all ReferenceDatasets associated with this workspace, with match reports."""
    _get_workspace(session, workspace_id)
    links = session.exec(
        select(WorkspaceReferenceDataset).where(
            WorkspaceReferenceDataset.workspace_id == workspace_id
        )
    ).all()
    result = []
    for link in links:
        dataset = session.get(ReferenceDataset, link.dataset_id)
        if not dataset:
            continue
        report = _compute_match_report(session, workspace_id, dataset)
        result.append(
            ReferenceDatasetWithMatch(
                **ReferenceDatasetPublic.model_validate(dataset).model_dump(),
                match_report=report,
            )
        )
    return result


@workspace_ref_router.post("/{dataset_id}", response_model=ReferenceDatasetWithMatch)
def associate_dataset(
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: uuid.UUID,
    dataset_id: uuid.UUID,
) -> Any:
    """Associate an uploaded ReferenceDataset with this workspace."""
    _get_workspace(session, workspace_id)
    dataset = session.get(ReferenceDataset, dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Reference dataset not found")

    existing = session.exec(
        select(WorkspaceReferenceDataset).where(
            WorkspaceReferenceDataset.workspace_id == workspace_id,
            WorkspaceReferenceDataset.dataset_id == dataset_id,
        )
    ).first()
    if not existing:
        link = WorkspaceReferenceDataset(
            workspace_id=workspace_id, dataset_id=dataset_id
        )
        session.add(link)
        session.commit()

    report = _compute_match_report(session, workspace_id, dataset)
    return ReferenceDatasetWithMatch(
        **ReferenceDatasetPublic.model_validate(dataset).model_dump(),
        match_report=report,
    )


@workspace_ref_router.delete("/{dataset_id}")
def remove_dataset_from_workspace(
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: uuid.UUID,
    dataset_id: uuid.UUID,
) -> dict[str, str]:
    """Remove the association between a dataset and this workspace (does not delete the dataset)."""
    _get_workspace(session, workspace_id)
    link = session.exec(
        select(WorkspaceReferenceDataset).where(
            WorkspaceReferenceDataset.workspace_id == workspace_id,
            WorkspaceReferenceDataset.dataset_id == dataset_id,
        )
    ).first()
    if not link:
        raise HTTPException(status_code=404, detail="Dataset not associated with this workspace")
    session.delete(link)
    session.commit()
    return {"message": "Dataset removed from workspace"}


@workspace_ref_router.get("/match")
def match_plot(
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: uuid.UUID,
    experiment: str = Query(...),
    location: str = Query(...),
    population: str = Query(...),
    plot_id: str = Query(...),
    col: str | None = Query(default=None),
    row: str | None = Query(default=None),
) -> Any:
    """
    Return all reference trait values for a given plot across all datasets
    associated with this workspace. Used by plot viewers.

    Response: [ { dataset_id, dataset_name, traits: { trait: value } } ]
    """
    _get_workspace(session, workspace_id)

    # Get all datasets associated with this workspace
    links = session.exec(
        select(WorkspaceReferenceDataset).where(
            WorkspaceReferenceDataset.workspace_id == workspace_id
        )
    ).all()

    results = []
    for link in links:
        dataset = session.get(ReferenceDataset, link.dataset_id)
        if not dataset:
            continue
        # Only consider datasets that match experiment/location/population
        if (dataset.experiment != experiment or
                dataset.location != location or
                dataset.population != population):
            continue

        # Look for a matching ReferencePlot
        ref_plot = session.exec(
            select(ReferencePlot).where(
                ReferencePlot.dataset_id == dataset.id,
                ReferencePlot.plot_id == plot_id,
            )
        ).first()

        # Fallback: match by col+row if plot_id not found
        if not ref_plot and col and row:
            ref_plot = session.exec(
                select(ReferencePlot).where(
                    ReferencePlot.dataset_id == dataset.id,
                    ReferencePlot.col == col,
                    ReferencePlot.row == row,
                )
            ).first()

        if ref_plot and ref_plot.traits:
            results.append({
                "dataset_id": str(dataset.id),
                "dataset_name": dataset.name,
                "dataset_date": dataset.date or "",
                "traits": ref_plot.traits,
            })

    return results
