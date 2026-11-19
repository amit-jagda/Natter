"""Model Enumerations.

Defines standardized enums for user roles and account statuses.
"""

from enum import Enum


class TenantRole(str, Enum):
    """User access roles within a tenant organization."""
    ADMIN = "admin"
    DOCTOR = "doctor"
    RECEPTIONIST = "receptionist"
    MANAGER = "manager"
    OPERATOR = "operator"
    VIEWER = "viewer"


class UserStatus(str, Enum):
    """Lifecycle status for user accounts."""
    ACTIVE = "active"
    INVITED = "invited"
    INACTIVE = "inactive"
    SUSPENDED = "suspended"

