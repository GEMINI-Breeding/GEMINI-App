FROM python:3.10-slim

# libgomp1 — GNU OpenMP runtime required by libdirp.so/libv_dirp.so (DJI
# built them with OpenMP support); not present in the slim base image.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgomp1 \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
      dji_thermal_sdk \
      numpy

# No proprietary DJI object code is baked in here — libdirp.so (and its
# sibling DJI libs: libexif.so.12, libMicroIA/JPEG/TA_Release_x64.so) are
# bind-mounted read-only at `docker run` time into /dji_sdk (see
# thermal_utils.py:_convert_dji_rjpeg_docker). That keeps this image
# generic/static: it never needs rebuilding when the vendored SDK version
# changes, and never itself embeds licensed object code.
ENV LD_LIBRARY_PATH=/dji_sdk

ARG GEMI_HASH=unknown
LABEL gemi.hash=${GEMI_HASH}

COPY measure_rjpeg.py /app/measure_rjpeg.py

ENTRYPOINT ["python", "/app/measure_rjpeg.py"]
