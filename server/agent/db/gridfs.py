"""
GridFS file storage for Dzeck AI Agent.
Ported from ai-manus/backend/app/infrastructure/external/file/gridfsfile.py.

Provides upload/download/list/delete of files to MongoDB GridFS,
so agent-generated files are stored persistently (not just in E2B sandbox).
"""
import io
import os
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_motor_available = False
try:
    from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorGridFSBucket
    _motor_available = True
except ImportError:
    logger.warning("[GridFS] motor not installed. GridFS storage disabled.")

try:
    from bson import ObjectId
    _bson_available = True
except ImportError:
    _bson_available = False
    logger.warning("[GridFS] bson not installed. GridFS storage disabled.")


def _get_uri() -> str:
    return os.environ.get("MONGODB_URI", "")


def _get_db_name() -> str:
    return "manus"


_client: Any = None
_db: Any = None


async def _get_motor_db() -> Any:
    global _client, _db
    if _db is not None:
        return _db
    uri = _get_uri()
    if not uri:
        raise RuntimeError("[GridFS] MONGODB_URI is not set. GridFS storage requires MongoDB.")
    if not _motor_available:
        raise RuntimeError("[GridFS] motor package is not installed. GridFS storage requires motor.")
    if not _bson_available:
        raise RuntimeError("[GridFS] bson package is not installed. GridFS storage requires bson.")
    _client = AsyncIOMotorClient(
        uri,
        serverSelectionTimeoutMS=5000,
        connectTimeoutMS=5000,
    )
    _db = _client[_get_db_name()]
    return _db


async def _get_bucket(bucket_name: str = "agent_files") -> Any:
    db = await _get_motor_db()
    return AsyncIOMotorGridFSBucket(db, bucket_name=bucket_name)


async def upload_file(
    session_id: str,
    filename: str,
    data_bytes: bytes,
    mime_type: str = "application/octet-stream",
    user_id: str = "",
    bucket_name: str = "agent_files",
) -> str:
    """
    Upload a file to GridFS.

    Args:
        session_id: The agent session ID that produced this file.
        filename: The file name (basename).
        data_bytes: Raw file bytes.
        mime_type: MIME type of the file.
        user_id: Owner user ID (for access control).
        bucket_name: GridFS bucket name.

    Returns:
        The GridFS file_id as a hex string.
    """
    bucket = await _get_bucket(bucket_name)
    metadata = {
        "session_id": session_id,
        "user_id": user_id,
        "contentType": mime_type,
        "uploadDate": datetime.now(timezone.utc),
        "filename": filename,
    }
    stream = io.BytesIO(data_bytes)
    file_id = await bucket.upload_from_stream(
        filename,
        stream,
        metadata=metadata,
    )
    logger.info("[GridFS] Uploaded %s (%d bytes) for session %s → file_id=%s", filename, len(data_bytes), session_id, file_id)
    return str(file_id)


async def download_file(
    file_id: str,
    bucket_name: str = "agent_files",
) -> bytes:
    """
    Download a file from GridFS by file_id.

    Args:
        file_id: The GridFS file_id (hex string).
        bucket_name: GridFS bucket name.

    Returns:
        Raw file bytes.

    Raises:
        FileNotFoundError: If the file does not exist.
        ValueError: If the file_id format is invalid.
    """
    if not _bson_available:
        raise RuntimeError("[GridFS] bson not available.")
    try:
        obj_id = ObjectId(file_id)
    except Exception:
        raise ValueError(f"Invalid file_id format: {file_id}")
    bucket = await _get_bucket(bucket_name)
    stream = io.BytesIO()
    try:
        await bucket.download_to_stream(obj_id, stream)
    except Exception as exc:
        raise FileNotFoundError(f"File not found in GridFS: {file_id}") from exc
    stream.seek(0)
    return stream.read()


class FileMetadata:
    """Lightweight metadata container for a GridFS file."""
    def __init__(
        self,
        file_id: str,
        filename: str,
        size: int,
        mime_type: str,
        session_id: str,
        user_id: str,
        upload_date: datetime,
    ) -> None:
        self.file_id = file_id
        self.filename = filename
        self.size = size
        self.mime_type = mime_type
        self.session_id = session_id
        self.user_id = user_id
        self.upload_date = upload_date

    def to_dict(self) -> Dict[str, Any]:
        return {
            "file_id": self.file_id,
            "filename": self.filename,
            "size": self.size,
            "mime_type": self.mime_type,
            "session_id": self.session_id,
            "user_id": self.user_id,
            "upload_date": self.upload_date.isoformat() if self.upload_date else None,
        }


async def list_files(
    session_id: str,
    bucket_name: str = "agent_files",
) -> List[FileMetadata]:
    """
    List all files stored for a given session.

    Args:
        session_id: The agent session ID.
        bucket_name: GridFS bucket name.

    Returns:
        List of FileMetadata objects.
    """
    db = await _get_motor_db()
    files_collection = db[f"{bucket_name}.files"]
    cursor = files_collection.find(
        {"metadata.session_id": session_id},
        {"_id": 1, "filename": 1, "length": 1, "metadata": 1, "uploadDate": 1},
    ).sort("uploadDate", 1)
    results: List[FileMetadata] = []
    async for doc in cursor:
        meta = doc.get("metadata", {}) or {}
        results.append(FileMetadata(
            file_id=str(doc["_id"]),
            filename=doc.get("filename", ""),
            size=doc.get("length", 0),
            mime_type=meta.get("contentType", "application/octet-stream"),
            session_id=meta.get("session_id", session_id),
            user_id=meta.get("user_id", ""),
            upload_date=doc.get("uploadDate") or datetime.now(timezone.utc),
        ))
    return results


async def delete_file(
    file_id: str,
    bucket_name: str = "agent_files",
) -> bool:
    """
    Delete a file from GridFS by file_id.

    Args:
        file_id: The GridFS file_id (hex string).
        bucket_name: GridFS bucket name.

    Returns:
        True if deleted, False if not found.
    """
    if not _bson_available:
        raise RuntimeError("[GridFS] bson not available.")
    try:
        obj_id = ObjectId(file_id)
    except Exception:
        raise ValueError(f"Invalid file_id format: {file_id}")
    bucket = await _get_bucket(bucket_name)
    try:
        await bucket.delete(obj_id)
        logger.info("[GridFS] Deleted file_id=%s", file_id)
        return True
    except Exception as exc:
        logger.warning("[GridFS] Delete failed for file_id=%s: %s", file_id, exc)
        return False


async def get_file_metadata(
    file_id: str,
    bucket_name: str = "agent_files",
) -> Optional[FileMetadata]:
    """Get metadata for a single file by file_id."""
    if not _bson_available:
        return None
    try:
        obj_id = ObjectId(file_id)
    except Exception:
        return None
    db = await _get_motor_db()
    files_collection = db[f"{bucket_name}.files"]
    doc = await files_collection.find_one({"_id": obj_id})
    if not doc:
        return None
    meta = doc.get("metadata", {}) or {}
    return FileMetadata(
        file_id=str(doc["_id"]),
        filename=doc.get("filename", ""),
        size=doc.get("length", 0),
        mime_type=meta.get("contentType", "application/octet-stream"),
        session_id=meta.get("session_id", ""),
        user_id=meta.get("user_id", ""),
        upload_date=doc.get("uploadDate") or datetime.now(timezone.utc),
    )
