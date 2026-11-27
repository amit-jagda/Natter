"""Healthcare Tool Registry.

Manages tool definitions, parameter schema generation, input validation,
server-controlled verification gating, and secure tenant-isolated execution.
"""

import inspect
import logging
import uuid
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Dict, List, Optional, Type

from pydantic import BaseModel, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.llm.base import ToolDefinition
from app.services.conversation.state import ConversationState

logger = logging.getLogger(__name__)


@dataclass
class RegisteredTool:
    """Internal registration metadata for a callable tool."""

    name: str
    description: str
    parameter_model: Type[BaseModel]
    handler: Callable[..., Awaitable[Dict[str, Any]]]
    requires_verification: bool = False
    is_idempotent: bool = False


def _pydantic_to_gemini_schema(model: Type[BaseModel]) -> Dict[str, Any]:
    """Convert a Pydantic model into a clean JSON Schema compatible with Gemini/OpenAI tool definitions."""
    schema = model.model_json_schema()
    # Strip unnecessary top-level meta properties that can confuse LLM function declaration parsers
    properties = schema.get("properties", {})
    required = schema.get("required", [])

    clean_props = {}
    for prop_name, prop_def in properties.items():
        clean_prop: Dict[str, Any] = {
            "type": prop_def.get("type", "string"),
        }
        if "description" in prop_def:
            clean_prop["description"] = prop_def["description"]
        if "enum" in prop_def:
            clean_prop["enum"] = prop_def["enum"]
        clean_props[prop_name] = clean_prop

    return {
        "type": "object",
        "properties": clean_props,
        "required": required,
    }


class ToolRegistry:
    """Registry managing tool schemas and dispatching validated calls."""

    def __init__(self) -> None:
        self._tools: Dict[str, RegisteredTool] = {}

    def register(
        self,
        name: str,
        description: str,
        parameter_model: Type[BaseModel],
        requires_verification: bool = False,
        is_idempotent: bool = False,
    ) -> Callable[[Callable[..., Awaitable[Dict[str, Any]]]], Callable[..., Awaitable[Dict[str, Any]]]]:
        """Decorator to register a tool with schema validation and verification gates."""

        def decorator(
            func: Callable[..., Awaitable[Dict[str, Any]]]
        ) -> Callable[..., Awaitable[Dict[str, Any]]]:
            self._tools[name] = RegisteredTool(
                name=name,
                description=description,
                parameter_model=parameter_model,
                handler=func,
                requires_verification=requires_verification,
                is_idempotent=is_idempotent,
            )
            return func

        return decorator

    def get_definitions(self) -> List[ToolDefinition]:
        """Generate provider-independent ToolDefinition list for the LLM Gateway."""
        definitions = []
        for name, tool in self._tools.items():
            parameters = _pydantic_to_gemini_schema(tool.parameter_model)
            definitions.append(
                ToolDefinition(
                    name=name,
                    description=tool.description,
                    parameters=parameters,
                )
            )
        return definitions

    async def execute_tool(
        self,
        name: str,
        arguments: Dict[str, Any],
        *,
        tenant_id: Optional[uuid.UUID],
        db: Optional[AsyncSession],
        session_state: ConversationState,
    ) -> Dict[str, Any]:
        """Validate input arguments, enforce verification gates, and execute tool securely.

        Args:
            name: Registered tool name.
            arguments: Dictionary of arguments provided by the LLM.
            tenant_id: Authoritative tenant ID.
            db: Active async database session.
            session_state: Active conversation state.

        Returns:
            Dict containing tool execution result.
        """
        if name not in self._tools:
            logger.warning("Attempt to execute unknown tool: %s", name)
            return {
                "success": False,
                "error_code": "UNKNOWN_TOOL",
                "error": f"Tool '{name}' is not recognized.",
            }

        tool = self._tools[name]

        # 1. Verification Lockout check
        if session_state.is_verification_locked():
            return {
                "success": False,
                "error_code": "VERIFICATION_LOCKED",
                "message": (
                    "Verification attempts are temporarily locked for security. "
                    "Please inform the patient that they are being transferred to human staff."
                ),
                "action_signal": "transfer_to_human",
                "stage": "escalated",
            }

        # 2. Verification Gate check
        if tool.requires_verification:
            if not session_state.is_verified() or not session_state.verified_patient_id:
                logger.info(
                    "Rejected tool '%s' due to unverified session %s",
                    name,
                    session_state.session_id,
                )
                return {
                    "success": False,
                    "error_code": "UNVERIFIED",
                    "message": (
                        "Patient identity has not been verified yet. "
                        "You must first ask the patient for their full name and contact phone number "
                        "and call verify_patient_identity before executing this operation."
                    ),
                }

        # 3. Input Argument Validation using Pydantic
        try:
            validated_params = tool.parameter_model.model_validate(arguments or {})
        except ValidationError as val_err:
            error_details = []
            for err in val_err.errors():
                loc = ".".join(str(part) for part in err.get("loc", []))
                msg = err.get("msg", "Invalid")
                error_details.append(f"{loc}: {msg}")
            error_msg = "; ".join(error_details)
            logger.warning("Tool argument validation failed for '%s': %s", name, error_msg)
            return {
                "success": False,
                "error_code": "INVALID_ARGUMENTS",
                "error": f"Invalid arguments for {name}: {error_msg}",
            }

        # 4. Invoke Handler with Dependency Injection
        try:
            handler_kwargs: Dict[str, Any] = {
                "params": validated_params,
                "tenant_id": tenant_id,
                "db": db,
                "session_state": session_state,
            }

            # Filter handler kwargs to match target signature
            sig = inspect.signature(tool.handler)
            accepted_kwargs = {
                k: v for k, v in handler_kwargs.items() if k in sig.parameters
            }

            result = await tool.handler(**accepted_kwargs)
            if not isinstance(result, dict):
                result = {"success": True, "data": result}
            return result

        except Exception as exc:
            logger.error("Unhandled exception during tool execution '%s': %s", name, exc, exc_info=True)
            return {
                "success": False,
                "error_code": "INTERNAL_EXECUTION_ERROR",
                "error": f"An unexpected error occurred while executing {name}.",
            }
