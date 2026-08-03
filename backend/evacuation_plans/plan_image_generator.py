from pathlib import Path

from .image_generator import (
    GeneratedPlanResult,
    MissingAPIKeyError,
    generate_cleaned_plan as generate_cleaned_plan_with_key,
)
from .models import UserOpenAISettings


def get_saved_openai_api_key(user) -> str:
    settings_obj = UserOpenAISettings.objects.filter(user=user).first()
    if not settings_obj:
        raise MissingAPIKeyError("missing_saved_api_key")
    return settings_obj.get_api_key()


def generate_cleaned_plan(
    source_image,
    generation_prompt: str,
    user,
    quality: str = "medium",
    *,
    plan=None,
) -> GeneratedPlanResult:
    api_key = get_saved_openai_api_key(user)
    return generate_cleaned_plan_with_key(
        source_image=source_image,
        prompt=generation_prompt,
        api_key=api_key,
        quality=quality,
        user=user,
        plan=plan,
    )


def read_generated_image_bytes(result: GeneratedPlanResult) -> bytes:
    return Path(result.image_path).read_bytes()
