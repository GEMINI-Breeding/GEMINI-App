"""
AgML public dataset discovery API routes.

  GET    /agml/datasets              list/filter the public AgML catalog
  GET    /agml/datasets/{name}       one dataset's metadata
  GET    /agml/datasets/{name}/similar   datasets sharing the same task
  GET    /agml/selected              datasets the user has marked as interesting
  POST   /agml/selected              select a dataset (upsert)
  DELETE /agml/selected/{name}       unselect a dataset
  GET    /agml/leaderboard           placeholder — see LeaderboardPublic docstring

Dataset discovery only — no dataset content is ever downloaded here, and no
model training happens anywhere in this router.
"""

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from sqlmodel import select

from app.api.deps import CurrentUser, SessionDep
from app.models.agml_dataset import (
    AgmlDatasetPublic,
    LeaderboardPublic,
    SelectedAgmlDataset,
    SelectedAgmlDatasetCreate,
    SelectedAgmlDatasetPublic,
    SimilarDatasetsPublic,
)
from app.processing import agml_utils

router = APIRouter(prefix="/agml", tags=["agml"])


def _selected_names(session: SessionDep) -> set[str]:
    rows = session.exec(select(SelectedAgmlDataset.dataset_name)).all()
    return set(rows)


def _unavailable(exc: Exception) -> HTTPException:
    return HTTPException(status_code=503, detail=f"AgML dataset catalog unavailable: {exc}")


@router.get("/datasets", response_model=list[AgmlDatasetPublic])
def list_datasets(
    session: SessionDep,
    current_user: CurrentUser,
    ml_task: str | None = Query(default=None),
    ag_task: str | None = Query(default=None),
    location: str | None = Query(default=None, description="'continent:africa' or 'country:denmark'"),
    sensor_modality: str | None = Query(default=None),
    platform: str | None = Query(default=None),
    real_synthetic: str | None = Query(default=None),
    n_images_min: int | None = Query(default=None),
    n_images_max: int | None = Query(default=None),
    search: str | None = Query(default=None),
) -> Any:
    try:
        return agml_utils.list_datasets(
            ml_task=ml_task,
            ag_task=ag_task,
            location=location,
            sensor_modality=sensor_modality,
            platform=platform,
            real_synthetic=real_synthetic,
            n_images_min=n_images_min,
            n_images_max=n_images_max,
            search=search,
            selected_names=_selected_names(session),
        )
    except agml_utils.AgmlUnavailableError as exc:
        raise _unavailable(exc)


@router.get("/datasets/{name}", response_model=AgmlDatasetPublic)
def get_dataset(session: SessionDep, current_user: CurrentUser, name: str) -> Any:
    try:
        result = agml_utils.get_dataset(name, selected_names=_selected_names(session))
    except agml_utils.AgmlUnavailableError as exc:
        raise _unavailable(exc)
    if result is None:
        raise HTTPException(status_code=404, detail=f"AgML dataset '{name}' not found")
    return result


@router.get("/datasets/{name}/similar", response_model=SimilarDatasetsPublic)
def get_similar_datasets(
    session: SessionDep,
    current_user: CurrentUser,
    name: str,
    limit: int = Query(default=5, ge=1, le=50),
) -> Any:
    try:
        candidates = agml_utils.find_similar(name, limit=limit, selected_names=_selected_names(session))
    except agml_utils.AgmlUnavailableError as exc:
        raise _unavailable(exc)
    if candidates is None:
        raise HTTPException(status_code=404, detail=f"AgML dataset '{name}' not found")
    return {"source": name, "candidates": candidates}


@router.get("/selected", response_model=list[SelectedAgmlDatasetPublic])
def list_selected(session: SessionDep, current_user: CurrentUser) -> Any:
    rows = session.exec(select(SelectedAgmlDataset).order_by(SelectedAgmlDataset.selected_at.desc())).all()
    selected_names = {row.dataset_name for row in rows}
    results = []
    for row in rows:
        try:
            meta = agml_utils.get_dataset(row.dataset_name, selected_names=selected_names)
        except agml_utils.AgmlUnavailableError:
            meta = None
        results.append(
            SelectedAgmlDatasetPublic(
                dataset_name=row.dataset_name,
                notes=row.notes,
                selected_at=row.selected_at,
                dataset_metadata=meta,
            )
        )
    return results


@router.post("/selected", response_model=SelectedAgmlDatasetPublic)
def select_dataset(
    session: SessionDep,
    current_user: CurrentUser,
    body: SelectedAgmlDatasetCreate,
) -> Any:
    try:
        meta = agml_utils.get_dataset(body.dataset_name, selected_names={body.dataset_name})
    except agml_utils.AgmlUnavailableError as exc:
        raise _unavailable(exc)
    if meta is None:
        raise HTTPException(status_code=404, detail=f"AgML dataset '{body.dataset_name}' not found")

    existing = session.get(SelectedAgmlDataset, body.dataset_name)
    if existing:
        existing.notes = body.notes
        session.add(existing)
        session.commit()
        session.refresh(existing)
        row = existing
    else:
        row = SelectedAgmlDataset(dataset_name=body.dataset_name, notes=body.notes)
        session.add(row)
        session.commit()
        session.refresh(row)

    return SelectedAgmlDatasetPublic(
        dataset_name=row.dataset_name,
        notes=row.notes,
        selected_at=row.selected_at,
        dataset_metadata=meta,
    )


@router.delete("/selected/{name}")
def unselect_dataset(session: SessionDep, current_user: CurrentUser, name: str) -> Any:
    row = session.get(SelectedAgmlDataset, name)
    if not row:
        raise HTTPException(status_code=404, detail=f"'{name}' is not selected")
    session.delete(row)
    session.commit()
    return {"message": f"'{name}' removed from selected datasets"}


@router.get("/datasets/{name}/benchmarks")
def get_dataset_benchmarks(session: SessionDep, current_user: CurrentUser, name: str) -> Any:
    """Prior foundation-model benchmark results for one dataset, if agml has any."""
    try:
        meta = agml_utils.get_dataset(name, selected_names=_selected_names(session))
    except agml_utils.AgmlUnavailableError as exc:
        raise _unavailable(exc)
    if meta is None:
        raise HTTPException(status_code=404, detail=f"AgML dataset '{name}' not found")
    try:
        results = agml_utils.get_benchmarks(name)
    except agml_utils.AgmlUnavailableError as exc:
        raise _unavailable(exc)
    return {"dataset": name, "results": results}


@router.get("/leaderboard", response_model=LeaderboardPublic)
def get_leaderboard(current_user: CurrentUser) -> Any:
    """
    Sourced from agml's own bundled prior-benchmark JSON (small, fully
    offline) — see LeaderboardPublic's docstring for why this isn't a stub.
    """
    try:
        models = agml_utils.all_benchmarks()
    except agml_utils.AgmlUnavailableError as exc:
        raise _unavailable(exc)
    return LeaderboardPublic(models=models)
