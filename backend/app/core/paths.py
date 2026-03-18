"""
Centralised path computation for pipeline processing.

All intermediate and processed output paths are derived from data already in
the database (workspace name, run metadata) plus the user-configured data_root.
Nothing is hardcoded.

Usage
-----
    paths = RunPaths.from_db(session=session, run=run, workspace=workspace)
    paths.make_dirs()

    raw_images    = paths.raw
    plot_borders  = paths.plot_borders          # pipeline-level, reused across runs
    stitch_output = paths.agrowstitch_dir()     # processed outputs
    msgs_synced   = paths.msgs_synced           # run-level intermediate

Directory layout
----------------
{data_root}/
  Raw/
    {year}/{experiment}/{location}/{population}/{date}/{platform}/
      Metadata/    ← platform logs (.bin/.log/.tlog) uploaded here
      {sensor}/    ← drone images uploaded here
  Intermediate/
    {workspace_name}/
      {year}/{experiment}/{location}/{population}/   ← year-level artifacts (matches Raw layout)
        plot_borders.csv
        plot_borders_v{N}.csv
        Plot-Boundary-WGS84.geojson
        Plot-Boundary-WGS84_v{N}.geojson
        stitch_mask.json
        gcp_locations.csv
        field_design.csv
        Pop-Boundary-WGS84.geojson
        {date}/{platform}/{sensor}/                  ← run-level artifacts
          msgs_synced.csv
          gcp_list.txt
          geo.txt
          temp/                (ODM working dir)
          plot_images/         (aerial: split plot PNGs)
  Processed/
    {workspace_name}/
      {experiment}/{location}/{population}/{date}/{platform}/{sensor}/
        AgRowStitch_v{N}/      (ground outputs)
          full_res_mosaic_temp_plot_{id}.png
          georeferenced_plot_{id}_utm.tif
          combined_mosaic_utm.tif
          roboflow_predictions_{task}.csv
          Traits-WGS84.geojson
        {date}-RGB.tif         (aerial outputs)
        {date}-DEM.tif
        cropped_images/
        Traits-WGS84.geojson
        roboflow_predictions_{task}.csv
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from sqlmodel import Session

from app.core.config import settings
from app.crud.app_settings import get_setting

if TYPE_CHECKING:
    from app.models.pipeline import PipelineRun
    from app.models.workspace import Workspace


@dataclass
class RunPaths:
    """
    All filesystem paths relevant to a single PipelineRun.

    Build via RunPaths.from_db() — do not construct manually in route handlers.
    All paths are absolute; relative versions (for storage in run.outputs JSON)
    are available via the .rel() helper.
    """

    data_root: Path
    workspace_name: str
    experiment: str
    location: str
    population: str
    date: str
    platform: str
    sensor: str

    # ── Internal helpers ──────────────────────────────────────────────────

    @property
    def _year(self) -> str:
        """Year extracted from date string (e.g. '2024-06-15' → '2024')."""
        return self.date.split("-")[0] if self.date and "-" in self.date else self.date

    @property
    def _pop_seg(self) -> Path:
        """experiment/location/population segment."""
        return Path(self.experiment) / self.location / self.population

    @property
    def _run_seg(self) -> Path:
        """date/platform/sensor segment."""
        return Path(self.date) / self.platform / self.sensor

    # ── Raw (read-only source data) ───────────────────────────────────────

    @property
    def raw(self) -> Path:
        """Raw/{year}/{experiment}/{location}/{population}/{date}/{platform}/{sensor}/

        The year prefix matches the upload directory structure built by the
        Files tab (dataTypes.ts includes a Year field derived from date).
        """
        return self.data_root / "Raw" / self._year / self._pop_seg / self._run_seg

    @property
    def raw_metadata(self) -> Path:
        """Raw/.../Platform/Metadata/ — platform logs (.bin/.log) live here.
        One level above sensor (platform log is shared across all sensors on that flight)."""
        return self.raw.parent / "Metadata"

    @property
    def gcp_locations_raw(self) -> Path:
        """gcp_locations.csv at the population level in Raw/ (shared across dates)."""
        return self.data_root / "Raw" / self._year / self._pop_seg / "gcp_locations.csv"

    # ── Intermediate: pipeline-level (workspace + population, no year) ────
    # NOTE: kept for backward-compat with make_dirs only; prefer intermediate_year

    @property
    def intermediate_pipeline(self) -> Path:
        """Intermediate/{workspace}/{experiment}/{location}/{population}/
        (Legacy — no year prefix.  Use intermediate_year for year-scoped artifacts.)
        """
        return self.data_root / "Intermediate" / self.workspace_name / self._pop_seg

    # ── Intermediate: year-level (shared across runs within a year) ────────

    @property
    def intermediate_year(self) -> Path:
        """Intermediate/{workspace}/{year}/{experiment}/{location}/{population}/
        Matches Raw layout: year is immediately under the workspace prefix.
        """
        return self.data_root / "Intermediate" / self.workspace_name / self._year / self._pop_seg

    @property
    def plot_borders(self) -> Path:
        """Ground: plot_borders.csv — year-specific, reused across runs within a year."""
        return self.intermediate_year / "plot_borders.csv"

    def plot_borders_versioned(self, version: int) -> Path:
        return self.intermediate_year / f"plot_borders_v{version}.csv"

    @property
    def stitch_mask(self) -> Path:
        """Ground: stitch_mask.json — year-specific config."""
        return self.intermediate_year / "stitch_mask.json"

    @property
    def plot_boundary_geojson(self) -> Path:
        """Aerial/Ground: Plot-Boundary-WGS84.geojson — year-specific."""
        return self.intermediate_year / "Plot-Boundary-WGS84.geojson"

    def plot_boundary_geojson_versioned(self, version: int) -> Path:
        return self.intermediate_year / f"Plot-Boundary-WGS84_v{version}.geojson"

    @property
    def field_design_dir(self) -> Path:
        """Raw/{year}/.../FieldDesign/ — field design CSVs uploaded via Files tab."""
        return self.data_root / "Raw" / self._year / self._pop_seg / "FieldDesign"

    def field_design_csv(self) -> Path | None:
        """
        Return the first field design CSV found in the Raw upload dir,
        or None if not found.  Falls back to intermediate (inline upload).
        """
        raw_dir = self.field_design_dir
        if raw_dir.exists():
            for p in sorted(raw_dir.iterdir()):
                if p.suffix.lower() == ".csv":
                    return p
        inline = self.field_design_intermediate
        return inline if inline.exists() else None

    @property
    def field_design_intermediate(self) -> Path:
        """Inline field_design.csv saved during plot boundary prep (year-specific)."""
        return self.intermediate_year / "field_design.csv"

    @property
    def pop_boundary_geojson(self) -> Path:
        """Population (outer field) boundary — year-specific."""
        return self.intermediate_year / "Pop-Boundary-WGS84.geojson"

    @property
    def gcp_locations_intermediate(self) -> Path:
        """Inline gcp_locations.csv — year-specific (field layout may change per year)."""
        return self.intermediate_year / "gcp_locations.csv"

    def gcp_locations(self) -> Path:
        """
        Return the correct gcp_locations.csv path.
        Prefers Raw/ (uploaded via Platform Logs); falls back to Intermediate/.
        """
        raw_path = self.gcp_locations_raw
        return raw_path if raw_path.exists() else self.gcp_locations_intermediate

    # ── Intermediate: run-level ───────────────────────────────────────────

    @property
    def intermediate_run(self) -> Path:
        """Intermediate/{workspace}/{year}/{experiment}/{location}/{population}/{date}/{platform}/{sensor}/"""
        return self.intermediate_year / self._run_seg

    @property
    def msgs_synced(self) -> Path:
        """Aerial & ground: image GPS manifest (EXIF + optional drone-log correction)."""
        return self.intermediate_run / "msgs_synced.csv"

    @property
    def drone_msgs(self) -> Path:
        """Aerial: GPS/LiDAR/attitude extracted from ArduPilot platform log."""
        return self.intermediate_run / "drone_msgs.csv"

    @property
    def gcp_list(self) -> Path:
        """Aerial: gcp_list.txt — pixel coordinates for each GCP."""
        return self.intermediate_run / "gcp_list.txt"

    @property
    def geo_txt(self) -> Path:
        """Aerial: geo.txt — image GPS positions for ODM."""
        return self.intermediate_run / "geo.txt"

    @property
    def odm_working_dir(self) -> Path:
        """Aerial: ODM temp/working directory."""
        return self.intermediate_run / "temp"

    @property
    def plot_images_dir(self) -> Path:
        """Aerial: split plot PNGs produced by ODM crop step."""
        return self.intermediate_run / "plot_images"

    # ── Processed outputs ─────────────────────────────────────────────────

    @property
    def processed_run(self) -> Path:
        """Processed/{workspace}/{experiment}/{location}/{population}/{date}/{platform}/{sensor}/"""
        return (
            self.data_root
            / "Processed"
            / self.workspace_name
            / self._pop_seg
            / self._run_seg
        )

    def agrowstitch_dir(self, version: int = 1) -> Path:
        """Ground: AgRowStitch_v{N}/ output directory."""
        return self.processed_run / f"AgRowStitch_v{version}"

    @property
    def aerial_rgb(self) -> Path:
        """Aerial: {date}-RGB.tif orthomosaic (legacy unversioned path)."""
        return self.processed_run / f"{self.date}-RGB.tif"

    @property
    def aerial_dem(self) -> Path:
        """Aerial: {date}-DEM.tif digital elevation model (legacy unversioned path)."""
        return self.processed_run / f"{self.date}-DEM.tif"

    @property
    def aerial_rgb_pyramid(self) -> Path:
        """Aerial: {date}-RGB-Pyramid.tif (legacy unversioned path)."""
        return self.processed_run / f"{self.date}-RGB-Pyramid.tif"

    def aerial_rgb_versioned(self, version: int) -> Path:
        """Aerial: {date}-RGB-v{N}.tif"""
        return self.processed_run / f"{self.date}-RGB-v{version}.tif"

    def aerial_dem_versioned(self, version: int) -> Path:
        """Aerial: {date}-DEM-v{N}.tif"""
        return self.processed_run / f"{self.date}-DEM-v{version}.tif"

    def aerial_rgb_pyramid_versioned(self, version: int) -> Path:
        """Aerial: {date}-RGB-Pyramid-v{N}.tif"""
        return self.processed_run / f"{self.date}-RGB-Pyramid-v{version}.tif"

    @property
    def cropped_images_dir(self) -> Path:
        """Aerial: cropped_images/ directory (latest, for backward compat)."""
        return self.processed_run / "cropped_images"

    def cropped_images_versioned(self, version: int) -> Path:
        """Aerial: per-trait-record versioned crop directory (cropped_images_v{N}/)."""
        return self.processed_run / f"cropped_images_v{version}"

    @property
    def traits_geojson(self) -> Path:
        """Shared: Traits-WGS84.geojson."""
        return self.processed_run / "Traits-WGS84.geojson"

    def roboflow_predictions(self, task: str) -> Path:
        """Shared: roboflow_predictions_{task}.csv."""
        return self.processed_run / f"roboflow_predictions_{task}.csv"

    # ── Utilities ─────────────────────────────────────────────────────────

    def rel(self, path: Path) -> str:
        """
        Return a path relative to data_root as a POSIX string.

        Store this in PipelineRun.outputs JSON so that paths remain valid
        even if the user changes their data_root setting.
        """
        return path.relative_to(self.data_root).as_posix()

    def abs(self, relative: str) -> Path:
        """Reconstruct an absolute path from a relative one (inverse of .rel())."""
        return self.data_root / relative

    def make_dirs(self) -> None:
        """Create all necessary directories for this run."""
        self.intermediate_year.mkdir(parents=True, exist_ok=True)
        self.intermediate_run.mkdir(parents=True, exist_ok=True)
        self.processed_run.mkdir(parents=True, exist_ok=True)

    # ── Factory ───────────────────────────────────────────────────────────

    @classmethod
    def from_db(
        cls,
        *,
        session: Session,
        run: "PipelineRun",
        workspace: "Workspace",
    ) -> "RunPaths":
        """
        Build RunPaths from DB objects.  This is the only place that reads
        data_root — route handlers should never call get_setting() for paths.
        """
        data_root = get_setting(session=session, key="data_root") or settings.APP_DATA_ROOT
        return cls(
            data_root=Path(data_root),
            workspace_name=workspace.name,
            experiment=run.experiment,
            location=run.location,
            population=run.population,
            date=run.date,
            platform=run.platform,
            sensor=run.sensor,
        )
