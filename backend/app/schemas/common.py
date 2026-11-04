"""Common and Generic API Schemas."""

from typing import Generic, List, Optional, TypeVar
from pydantic import BaseModel, Field

T = TypeVar("T")


class APIResponse(BaseModel, Generic[T]):
    """Standardized API response envelope."""
    success: bool = True
    data: Optional[T] = None
    message: Optional[str] = None


class PaginationParams(BaseModel):
    """Pagination query parameters."""
    page: int = Field(default=1, ge=1, description="Page number starting at 1")
    page_size: int = Field(default=20, ge=1, le=100, description="Items per page")


class PaginatedResponse(BaseModel, Generic[T]):
    """Standardized paginated list response."""
    items: List[T]
    total: int
    page: int
    page_size: int
    total_pages: int

