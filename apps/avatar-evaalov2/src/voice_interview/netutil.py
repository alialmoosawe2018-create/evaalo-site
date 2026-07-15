"""Connection / teardown error helpers."""


def is_websocket_closing_error(error: Exception) -> bool:
    error_msg = str(error).lower()
    error_type = type(error).__name__.lower()
    return (
        "closing transport" in error_msg
        or "connectionreset" in error_msg
        or "clientconnectionreseterror" in error_type
        or "cannot write to closing" in error_msg
    )
