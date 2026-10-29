# Python execution sandbox with document libraries preinstalled.
#
# Why this exists: the stock `code-interpreter-v1` has no PDF library, so every
# PDF request depended on the model remembering to `!pip install reportlab` in
# the same block as the import. It routinely did not, and production answered
# with `ModuleNotFoundError: No module named 'reportlab'`. Baking the libraries
# in removes both the failure and an unpinned, network-dependent install on
# every run.
#
# MUST stay on the code-interpreter base. `sbx.runCode()` does not exec a
# shell — it talks to the code-interpreter server on port 49999, which in turn
# drives a Jupyter kernel. A plain `python:3.13` image has neither, so code
# execution would break silently rather than fail at build time.
#
# `latest` is the only tag e2bdev publishes that is kept current (the others
# are from 2024/2025), so it cannot be pinned the way the pip packages below
# are. Rebuild deliberately and re-run `pnpm e2b:smoke` when you do.
FROM e2bdev/code-interpreter:latest

# The base image ends as USER user; installing needs root.
USER root

# WeasyPrint renders HTML/CSS to PDF through the system text stack: Pango and
# HarfBuzz shape the text, GDK-PixBuf loads raster images. The fonts are what
# stop a rendered page falling back to one ugly default face.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libpango-1.0-0 \
        libpangoft2-1.0-0 \
        libharfbuzz0b \
        libgdk-pixbuf-2.0-0 \
        libffi8 \
        shared-mime-info \
        fonts-dejavu-core \
        fonts-liberation2 \
    && rm -rf /var/lib/apt/lists/*

# Pinned: an unpinned install is exactly the drift this template exists to fix.
#
# Only the four that are actually missing. The base image already ships pandas,
# matplotlib, pillow, openpyxl and python-docx — reinstalling those would risk
# moving a version the Jupyter kernel already depends on.
#   reportlab  — programmatic layout (the house PDF style is written for it)
#   fpdf2      — small, quick one-pagers
#   weasyprint — HTML/CSS to PDF, which the create-pdf tool drives
#   pypdf      — merge/split/read existing PDFs
RUN pip install --no-cache-dir \
        reportlab==4.2.5 \
        fpdf2==2.8.2 \
        weasyprint==63.1 \
        pypdf==5.1.0 \
    && rm -rf /root/.cache/pip

# Prove the whole point of this template survived the build.
#
# This check used to live in the template's ready command, which the v2 build
# system runs in a loop until it exits 0 — so a missing or broken package meant
# the build hung until its one-hour limit rather than failing. An import is
# cheap; failing here costs seconds and names the package.
#
# WeasyPrint is the one that needs more than pip: it loads Pango and HarfBuzz at
# import time, so this also catches a missing system library above.
RUN python -c "import reportlab, fpdf, weasyprint, pypdf"

# Restore the base image's runtime identity. Relative `files.write()` calls
# from the app resolve against this directory, so a template rooted anywhere
# else silently receives its files in the wrong place.
USER user
WORKDIR /home/user
