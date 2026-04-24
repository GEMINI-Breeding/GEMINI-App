"""
Multispectral image band splitting — configuration, preview, and download.

Workflow:
  1. User uploads composite multispectral images via the standard file upload flow.
  2. After upload, a MultispectralUploadDialog opens and POSTs config here.
  3. Config is persisted per-upload and also saved as "last config" for quick reuse.
  4. Preview endpoint splits a single image and returns bands as base64 JPEG.
  5. Images endpoint lists all images with extracted timestamps (if configured).
  6. Download endpoint streams a ZIP of selected bands for selected images.

# FUTURE: timestamp-based matching to other sensor uploads (same date/location)
# and GPS from msgs_synced.csv for filtered download subsets. The ImageInfo model
# already includes timestamp_iso to enable this when the pipeline integration
# is built out.

# FUTURE: integrate split bands into the aerial pipeline — after splitting, each
# band could be treated as a separate "sensor" run and fed into the ODM orthomosaic
# and trait extraction steps. The MultispectralConfig stored here would be the
# source of truth for which band maps to which wavelength.
"""

import io
import json
import logging
import uuid
import zipfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlmodel import select

from app.api.deps import CurrentUser, SessionDep
from app.core.config import settings
from app.crud.app_settings import get_setting, set_setting
from app.models.file_upload import FileUpload
from app.models.multispectral import (
    MultispectralConfig,
    MultispectralConfigCreate,
    MultispectralConfigPublic,
)
from app.processing.multispectral_utils import (
    IMAGE_EXTENSIONS,
    extract_timestamp,
    image_to_base64,
    split_bands,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/multispectral", tags=["multispectral"])

LAST_CONFIG_KEY = "multispectral_last_config"


# ── Shared helpers ────────────────────────────────────────────────────────────

def _resolve(upload_id: uuid.UUID, session: SessionDep) -> tuple[FileUpload, Path]:
    upload = session.get(FileUpload, upload_id)
    if not upload:
        raise HTTPException(status_code=404, detail="Upload not found")
    raw_root = get_setting(session=session, key="data_root")
    data_root = Path(raw_root or settings.APP_DATA_ROOT)
    return upload, data_root


def _image_paths(upload: FileUpload, data_root: Path) -> list[Path]:
    storage_dir = data_root / upload.storage_path
    if not storage_dir.exists():
        return []
    return sorted(
        p for p in storage_dir.rglob("*")
        if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS
    )


# ── Config ────────────────────────────────────────────────────────────────────

class LastConfigResponse(BaseModel):
    config: dict[str, Any] | None


@router.get("/last-config", response_model=LastConfigResponse)
def get_last_config(session: SessionDep, current_user: CurrentUser) -> Any:
    raw = get_setting(session=session, key=LAST_CONFIG_KEY)
    if raw:
        try:
            return LastConfigResponse(config=json.loads(raw))
        except Exception:
            pass
    return LastConfigResponse(config=None)


@router.get("/{upload_id}/config", response_model=MultispectralConfigPublic | None)
def get_config(
    upload_id: uuid.UUID, session: SessionDep, current_user: CurrentUser
) -> Any:
    return session.exec(
        select(MultispectralConfig).where(
            MultispectralConfig.file_upload_id == upload_id
        )
    ).first()


@router.post("/{upload_id}/config", response_model=MultispectralConfigPublic)
def save_config(
    upload_id: uuid.UUID,
    body: MultispectralConfigCreate,
    session: SessionDep,
    current_user: CurrentUser,
) -> Any:
    existing = session.exec(
        select(MultispectralConfig).where(
            MultispectralConfig.file_upload_id == upload_id
        )
    ).first()

    if existing:
        existing.band_count = body.band_count
        existing.layout_cols = body.layout_cols
        existing.layout_rows = body.layout_rows
        existing.bands = body.bands
        existing.timestamp_source = body.timestamp_source
        existing.timestamp_format = body.timestamp_format
        session.add(existing)
    else:
        existing = MultispectralConfig(
            file_upload_id=upload_id,
            band_count=body.band_count,
            layout_cols=body.layout_cols,
            layout_rows=body.layout_rows,
            bands=body.bands,
            timestamp_source=body.timestamp_source,
            timestamp_format=body.timestamp_format,
        )
        session.add(existing)

    session.commit()
    session.refresh(existing)
    set_setting(session=session, key=LAST_CONFIG_KEY, value=json.dumps(body.model_dump()))
    return existing


# ── Preview ───────────────────────────────────────────────────────────────────

class PreviewRequest(BaseModel):
    image_index: int = 0
    layout_cols: int
    layout_rows: int
    bands: list[dict[str, Any]]


class BandPreview(BaseModel):
    index: int
    name: str
    wavelength_nm: float | None
    b64_jpeg: str
    width: int
    height: int


class PreviewResponse(BaseModel):
    source_filename: str
    source_width: int
    source_height: int
    bands: list[BandPreview]


@router.post("/{upload_id}/preview", response_model=PreviewResponse)
def preview_bands(
    upload_id: uuid.UUID,
    body: PreviewRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> Any:
    from PIL import Image as PILImage

    upload, data_root = _resolve(upload_id, session)
    images = _image_paths(upload, data_root)
    if not images:
        raise HTTPException(status_code=404, detail="No images found in this upload")

    img_path = images[min(body.image_index, len(images) - 1)]
    src = PILImage.open(img_path)
    src_w, src_h = src.size
    src.close()

    split = split_bands(img_path, body.layout_cols, body.layout_rows, body.bands)
    result_bands: list[BandPreview] = []
    for band_cfg, band_img in split:
        bw, bh = band_img.size
        result_bands.append(
            BandPreview(
                index=int(band_cfg["index"]),
                name=str(band_cfg.get("name") or f"Band {band_cfg['index'] + 1}"),
                wavelength_nm=band_cfg.get("wavelength_nm"),
                b64_jpeg=image_to_base64(band_img, "JPEG"),
                width=bw,
                height=bh,
            )
        )

    return PreviewResponse(
        source_filename=img_path.name,
        source_width=src_w,
        source_height=src_h,
        bands=result_bands,
    )


# ── Image listing with timestamps ─────────────────────────────────────────────

class ImageInfo(BaseModel):
    filename: str
    rel_path: str
    timestamp_iso: str | None


class ImagesResponse(BaseModel):
    images: list[ImageInfo]
    total: int


@router.get("/{upload_id}/images", response_model=ImagesResponse)
def list_images(
    upload_id: uuid.UUID, session: SessionDep, current_user: CurrentUser
) -> Any:
    upload, data_root = _resolve(upload_id, session)
    cfg = session.exec(
        select(MultispectralConfig).where(
            MultispectralConfig.file_upload_id == upload_id
        )
    ).first()

    image_paths = _image_paths(upload, data_root)
    storage_dir = data_root / upload.storage_path

    items: list[ImageInfo] = []
    for p in image_paths:
        ts = None
        if cfg:
            dt = extract_timestamp(p, cfg.timestamp_source, cfg.timestamp_format)
            ts = dt.isoformat() if dt else None
        items.append(
            ImageInfo(
                filename=p.name,
                rel_path=str(p.relative_to(storage_dir)),
                timestamp_iso=ts,
            )
        )

    return ImagesResponse(images=items, total=len(items))


# ── Download ──────────────────────────────────────────────────────────────────

class DownloadRequest(BaseModel):
    rel_paths: list[str]   # paths relative to the upload's storage_path
    band_indices: list[int]


@router.post("/{upload_id}/download")
def download_bands(
    upload_id: uuid.UUID,
    body: DownloadRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> StreamingResponse:
    upload, data_root = _resolve(upload_id, session)
    cfg = session.exec(
        select(MultispectralConfig).where(
            MultispectralConfig.file_upload_id == upload_id
        )
    ).first()
    if not cfg:
        raise HTTPException(
            status_code=404, detail="No band configuration found for this upload"
        )

    band_index_set = set(body.band_indices)
    selected_bands = [b for b in cfg.bands if int(b["index"]) in band_index_set]
    logger.info(
        "download_bands: upload=%s rel_paths=%s band_indices=%s -> selected=%d",
        upload_id, body.rel_paths[:3], body.band_indices, len(selected_bands),
    )
    if not selected_bands:
        raise HTTPException(status_code=400, detail="No valid band indices selected")

    storage_dir = (data_root / upload.storage_path).resolve()
    buf = io.BytesIO()

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for rel_path in body.rel_paths:
            img_path = (storage_dir / rel_path).resolve()
            # Security: ensure the path stays within storage_dir
            try:
                img_path.relative_to(storage_dir)
            except ValueError:
                logger.warning("Blocked path traversal attempt: %s", rel_path)
                continue
            if not img_path.exists():
                continue

            split = split_bands(img_path, cfg.layout_cols, cfg.layout_rows, selected_bands)
            stem = img_path.stem

            for band_cfg, band_img in split:
                band_name = str(band_cfg.get("name") or f"band{band_cfg['index'] + 1}")
                wl = band_cfg.get("wavelength_nm")
                wl_str = f"_{int(wl)}nm" if wl else ""
                out_name = f"{stem}_{band_name}{wl_str}.png"

                img_buf = io.BytesIO()
                if band_img.mode in ("RGBA", "LA", "P"):
                    band_img.save(img_buf, format="PNG")
                else:
                    band_img.convert("RGB").save(img_buf, format="PNG")
                zf.writestr(out_name, img_buf.getvalue())

    buf.seek(0)
    label = (upload.experiment or "multispectral").replace(" ", "_")
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="bands_{label}.zip"'
        },
    )
