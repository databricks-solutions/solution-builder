"""Images pasted into the chat composer.

Saved under the project's `context/uploads/` (the same folder the home-page
upload widget writes to), so they persist with the project and the agent can
re-open them later. The turn that carries them sends them to the model as
Anthropic image blocks, so the agent sees them without a Read call.
"""
from __future__ import annotations

import base64
import binascii
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any

UPLOADS_DIR = "context/uploads"
MEDIA_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
}
_EXT_TO_MEDIA = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                 ".gif": "image/gif", ".webp": "image/webp"}
MAX_IMAGES = 5
MAX_IMAGE_BYTES = 5 * 1024 * 1024  # the Anthropic API's per-image limit


def save_images(project_dir: Path, images: list[Any]) -> list[str]:
    """Write each `{filename, media_type, data_b64}` to `context/uploads/` and
    return the project-relative paths. Raises ValueError with a user-readable
    message on a bad image (type, size, encoding, count)."""
    if len(images) > MAX_IMAGES:
        raise ValueError(f"too many images: {len(images)} (max {MAX_IMAGES} per message)")
    decoded: list[tuple[str, bytes]] = []
    for img in images:
        ext = MEDIA_TYPES.get(img.media_type)
        if not ext:
            raise ValueError(f"unsupported image type: {img.media_type} (png, jpeg, gif or webp)")
        try:
            raw = base64.b64decode(img.data_b64, validate=True)
        except (binascii.Error, ValueError):
            raise ValueError(f"image '{img.filename}' is not valid base64") from None
        if not raw:
            raise ValueError(f"image '{img.filename}' is empty")
        if len(raw) > MAX_IMAGE_BYTES:
            raise ValueError(f"image '{img.filename}' is {len(raw):,} bytes; max is {MAX_IMAGE_BYTES:,}")
        # Leaf-only name (never trust a client path); the extension follows the real type.
        stem = PurePosixPath(img.filename or "").stem or "pasted-image"
        decoded.append((f"{stem}{ext}", raw))

    uploads = project_dir / UPLOADS_DIR
    uploads.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    paths: list[str] = []
    saved: dict[bytes, str] = {}
    for name, raw in decoded:
        if raw in saved:  # the same image twice in one message → sent once
            continue
        target = uploads / name
        if target.exists() and target.read_bytes() == raw:  # already saved earlier
            saved[raw] = f"{UPLOADS_DIR}/{target.name}"
            paths.append(saved[raw])
            continue
        if target.exists():  # a second "image.png" never clobbers the first
            target = uploads / f"{target.stem}-{stamp}{target.suffix}"
            n = 2
            while target.exists():
                target = uploads / f"{PurePosixPath(name).stem}-{stamp}-{n}{target.suffix}"
                n += 1
        target.write_bytes(raw)
        saved[raw] = f"{UPLOADS_DIR}/{target.name}"
        paths.append(saved[raw])
    return paths


def attachment_note(paths: list[str]) -> str:
    """The line appended to the user's message (persisted + sent), so the chat
    history and later turns know where the images live."""
    return "Attached image" + ("s" if len(paths) > 1 else "") + ": " + ", ".join(f"`{p}`" for p in paths)


def image_blocks(project_dir: Path, paths: list[str]) -> list[dict[str, Any]]:
    """Anthropic image content blocks for the saved images (missing files skipped)."""
    blocks = []
    for rel in paths:
        f = project_dir / rel
        media = _EXT_TO_MEDIA.get(f.suffix.lower())
        if not media or not f.is_file():
            continue
        blocks.append({
            "type": "image",
            "source": {"type": "base64", "media_type": media, "data": base64.b64encode(f.read_bytes()).decode("ascii")},
        })
    return blocks
