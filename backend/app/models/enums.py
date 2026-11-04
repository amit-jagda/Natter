"""Model Enumerations.

Defines standardized enums for user roles and account statuses.
"""

from enum import Enum


class TenantRole(str, Enum):
    """User access roles within a tenant organization."""
    ADMIN = "admin"
    MANAGER = "manager"
    OPERATOR = "operator"
    VIEWER = "viewer"


class UserStatus(str, Enum):
    """Lifecycle status for user accounts."""
    ACTIVE = "active"
    INACTIVE = "inactive"
    SUSPENDED = "suspended"

