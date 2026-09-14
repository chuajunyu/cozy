"""Safe, user-facing messages for OpenAI usage limits."""

LIMIT_MESSAGES = {
    'astra_credits_exhausted': "Sorry, we've run out of OpenAI credits or reached the spending limit. Please check billing and try again. Your room is saved.",
    'astra_rate_limited': 'OpenAI is temporarily limiting requests. Please wait a little and try again. Your room is saved.',
    'astra_usage_limited': "Sorry, OpenAI couldn't accept this request. We may have run out of credits or hit a temporary rate limit. Please try again shortly; if it continues, check billing. Your room is saved.",
}


class DesignServiceError(RuntimeError):
    def __init__(self, code: str) -> None:
        super().__init__(LIMIT_MESSAGES[code])
