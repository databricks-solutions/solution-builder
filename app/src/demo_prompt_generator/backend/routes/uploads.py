"""Stateless file extraction for the home-page upload widget.

The frontend POSTs files here at upload time; the response carries the
extracted text + the base64'd original. The frontend holds onto the
result and posts it BACK as part of `POST /api/projects` when the user
clicks Build. We don't write anything to disk or DB here — that happens
during project creation, scoped to the new project's directory.

Why this shape (extract first, persist later):
- The user might upload a file, then change their mind and never create
  the project — we don't want stray files on disk per attempt.
- The same file content needs to feed both `/api/capabilities/suggest`
  (for richer ideas) AND the project creation. The frontend keeping the
  result in memory makes that trivial; otherwise we'd need a transient
  upload-session table.
"""

from __future__ import annotations

import base64
import logging
from typing import Optional

from fastapi import HTTPException, UploadFile

from ..core import create_router
from ..models import UploadedFile
from ..services.file_extraction import SUPPORTED_EXTENSIONS, extract_text

router = create_router()
logger = logging.getLogger(__name__)

# Per-file raw byte cap. Anything bigger than 10 MB is almost certainly
# meant as a dataset, not as context — we'd just truncate aggressively
# anyway. Reject loudly so the user knows.
MAX_FILE_BYTES = 10 * 1024 * 1024  # 10 MB

# Total bytes across all files in one request. Rough guard against
# someone dumping a 1 GB upload at us — the per-file cap can't protect
# alone (5 × 10 MB = 50 MB is OK, much beyond that and we want to bail).
MAX_TOTAL_BYTES = 50 * 1024 * 1024  # 50 MB

# Max files per request. Bigger uploads should be handled via the
# project's file viewer (where the agent can iterate over them as needed),
# not the home-page context channel.
MAX_FILES_PER_REQUEST = 5

# Per-file extracted-char cap (≈30 KB of UTF-8). The frontend joins the
# extractions and re-caps the total at ~50 KB before sending to suggest.
MAX_CHARS_PER_FILE = 30_000


@router.post(
    "/uploads/extract",
    response_model=list[UploadedFile],
    operation_id="extractUploadedFiles",
)
async def extract_uploaded_files(
    files: Optional[list[UploadFile]] = None,
) -> list[UploadedFile]:
    """Extract text from each uploaded file. Pure function — no I/O.

    Returns one `UploadedFile` per input, in the same order. Errors are
    surfaced per-file by raising HTTPException on the first failure so
    the user sees one clear reason rather than a list of partial failures.
    """
    if not files:
        raise HTTPException(status_code=400, detail="no files in request")
    if len(files) > MAX_FILES_PER_REQUEST:
        raise HTTPException(
            status_code=400,
            detail=f"too many files: {len(files)} (max {MAX_FILES_PER_REQUEST} per upload)",
        )

    out: list[UploadedFile] = []
    total_bytes = 0
    for f in files:
        # FastAPI / Starlette streams the body; read into memory once so
        # we can both extract and base64-encode without rewinding.
        data = await f.read()
        if len(data) > MAX_FILE_BYTES:
            raise HTTPException(
                status_code=413,
                detail=(
                    f"file '{f.filename}' is {len(data):,} bytes; "
                    f"max is {MAX_FILE_BYTES:,} bytes per file"
                ),
            )
        if not data:
            raise HTTPException(
                status_code=400,
                detail=f"file '{f.filename}' is empty",
            )
        total_bytes += len(data)
        if total_bytes > MAX_TOTAL_BYTES:
            raise HTTPException(
                status_code=413,
                detail=(
                    f"upload too large: {total_bytes:,} bytes across all files; "
                    f"max is {MAX_TOTAL_BYTES:,} bytes total"
                ),
            )

        try:
            text, truncated = extract_text(
                f.filename or "unknown",
                data,
                max_chars=MAX_CHARS_PER_FILE,
            )
        except ValueError as e:
            # ValueError covers "unsupported file type" AND parser
            # failures wrapped by file_extraction.py. The message itself
            # is already user-readable; for unsupported types only, we
            # append the allowlist so the user knows what TO upload.
            msg = str(e)
            if msg.startswith("unsupported file type"):
                msg = f"{msg}. Supported: {', '.join(sorted(SUPPORTED_EXTENSIONS))}"
            logger.warning("upload rejected for %s: %s", f.filename, e)
            raise HTTPException(status_code=400, detail=msg) from e

        out.append(
            UploadedFile(
                filename=f.filename or "unknown",
                content_type=f.content_type or "application/octet-stream",
                size_bytes=len(data),
                text=text,
                truncated=truncated,
                original_b64=base64.b64encode(data).decode("ascii"),
            )
        )

    return out
