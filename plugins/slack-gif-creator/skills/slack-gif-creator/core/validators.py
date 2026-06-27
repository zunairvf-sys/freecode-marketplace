"""
Validators — Slack and Discord GIF size/dimension validation.

Ensures GIFs meet platform-specific requirements before delivery.

Usage:
    from validators import validate_slack_gif, validate_discord_gif

    issues = validate_slack_gif("output.gif")
    if issues:
        for issue in issues:
            print(f"Warning: {issue}")
"""

import os
from PIL import Image


# Platform limits
SLACK_MAX_SIZE = 10 * 1024 * 1024  # 10MB
SLACK_MAX_WIDTH = 480  # Slack resizes wider GIFs
SLACK_RECOMMENDED_WIDTH = 480
SLACK_RECOMMENDED_HEIGHT = 270

DISCORD_MAX_SIZE_ATTACH = 10 * 1024 * 1024  # 10MB for attachment
DISCORD_MAX_SIZE_EMOJI = 1 * 1024 * 1024  # 1MB for custom emoji
DISCORD_MAX_WIDTH = 480
DISCORD_MAX_HEIGHT = 270


def get_gif_info(path):
    """Get GIF file info: dimensions, frame count, file size."""
    size = os.path.getsize(path)
    with Image.open(path) as img:
        width, height = img.size
        frames = 1
        try:
            frames = img.n_frames or 1
        except AttributeError:
            pass
    return {
        'path': path,
        'width': width,
        'height': height,
        'size': size,
        'size_kb': size / 1024,
        'size_mb': size / (1024 * 1024),
        'frames': frames,
    }


def validate_slack_gif(path):
    """Validate a GIF against Slack requirements.

    Returns:
        List of issue strings. Empty list means the GIF passes validation.
    """
    issues = []
    info = get_gif_info(path)

    if info['size'] > SLACK_MAX_SIZE:
        issues.append(
            f"File size {info['size_mb']:.2f}MB exceeds Slack's 10MB limit"
        )

    if info['width'] > SLACK_MAX_WIDTH:
        issues.append(
            f"Width {info['width']}px exceeds Slack's {SLACK_MAX_WIDTH}px — "
            f"Slack will resize it, reducing quality"
        )

    if info['width'] > SLACK_RECOMMENDED_WIDTH:
        issues.append(
            f"Width {info['width']}px is wider than recommended "
            f"{SLACK_RECOMMENDED_WIDTH}px"
        )

    if info['frames'] < 2:
        issues.append("GIF has fewer than 2 frames — it won't animate")

    if info['frames'] > 300:
        issues.append(
            f"GIF has {info['frames']} frames — this may be slow to load"
        )

    return issues


def validate_discord_gif(path, as_emoji=False):
    """Validate a GIF against Discord requirements.

    Args:
        path: GIF file path
        as_emoji: If True, validate against stricter emoji limits (1MB)

    Returns:
        List of issue strings. Empty list means the GIF passes validation.
    """
    issues = []
    info = get_gif_info(path)

    max_size = (DISCORD_MAX_SIZE_EMOJI if as_emoji
                else DISCORD_MAX_SIZE_ATTACH)
    limit_label = "emoji (1MB)" if as_emoji else "attachment (10MB)"

    if info['size'] > max_size:
        issues.append(
            f"File size {info['size_mb']:.2f}MB exceeds Discord {limit_label}"
        )

    if info['width'] > DISCORD_MAX_WIDTH:
        issues.append(
            f"Width {info['width']}px exceeds Discord's {DISCORD_MAX_WIDTH}px"
        )

    if info['height'] > DISCORD_MAX_HEIGHT:
        issues.append(
            f"Height {info['height']}px exceeds Discord's {DISCORD_MAX_HEIGHT}px"
        )

    if info['frames'] < 2:
        issues.append("GIF has fewer than 2 frames — it won't animate")

    return issues


def validate_chat_gif(path, platform='slack'):
    """Validate a GIF for a specific chat platform.

    Args:
        path: GIF file path
        platform: 'slack', 'discord', 'discord_emoji', 'teams', or 'general'

    Returns:
        List of issue strings. Empty list means the GIF passes validation.
    """
    if platform == 'slack':
        return validate_slack_gif(path)
    elif platform == 'discord':
        return validate_discord_gif(path, as_emoji=False)
    elif platform == 'discord_emoji':
        return validate_discord_gif(path, as_emoji=True)
    elif platform == 'teams':
        # Teams has similar limits to Slack
        return validate_slack_gif(path)
    else:
        issues = []
        info = get_gif_info(path)
        if info['width'] > 600:
            issues.append(
                f"Width {info['width']}px is large — consider reducing to 480px"
            )
        if info['size_mb'] > 10:
            issues.append(
                f"File size {info['size_mb']:.2f}MB exceeds common 10MB limit"
            )
        return issues


def suggest_fixes(info, issues):
    """Suggest fixes for validation issues.

    Args:
        info: GIF info dict from get_gif_info()
        issues: Issue list from validation

    Returns:
        List of fix suggestion strings.
    """
    fixes = []

    for issue in issues:
        if "exceeds" in issue.lower() and "mb" in issue.lower():
            target_mb = 8 if "10MB" in issue else 0.8
            scale = target_mb / max(info['size_mb'], 0.01)
            new_frames = max(2, int(info['frames'] * scale))
            fixes.append(
                f"Reduce frames from {info['frames']} to ~{new_frames} "
                f"to fit the size limit"
            )
        elif "width" in issue.lower():
            fixes.append(
                f"Resize GIF to {SLACK_RECOMMENDED_WIDTH}px width"
            )
        elif "height" in issue.lower():
            fixes.append(
                f"Resize GIF to {DISCORD_MAX_HEIGHT}px height"
            )
        elif "fewer than 2 frames" in issue:
            fixes.append(
                "Add more animation frames (at least 2) for the GIF to animate"
            )
        elif "too many frames" in issue.lower() or "slow to load" in issue:
            fixes.append(
                f"Reduce frames from {info['frames']} to ~120 or lower"
            )

    return fixes
