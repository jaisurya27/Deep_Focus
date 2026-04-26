"""Inter-agent message models for internal routing between Glance agents."""
from uagents import Model


class RoutedRequest(Model):
    """Sent from the Orchestrator to a specialist agent."""
    text: str
    session_sender: str  # original ASI:One user address — pass back in response


class RoutedResponse(Model):
    """Sent from a specialist agent back to the Orchestrator."""
    text: str            # formatted markdown ready for ASI:One
    session_sender: str  # echoed through so orchestrator knows who to reply to
