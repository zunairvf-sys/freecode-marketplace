"""
Easing functions for smooth animations.

Provides standard easing curves:
  - linear: constant speed
  - ease_in: starts slow, accelerates
  - ease_out: starts fast, decelerates
  - ease_in_out: slow start and end, fast middle
  - bounce: elastic bounce effect

Usage:
    from easing import ease_in, ease_out, ease_in_out, bounce, linear

    for frame in range(60):
        t = frame / 59  # normalize to 0-1
        y = 100 + int(200 * ease_out(t))
"""


def linear(t):
    """Constant speed — no easing."""
    return t


def ease_in(t):
    """Starts slow, accelerates toward the end."""
    return t * t


def ease_out(t):
    """Starts fast, decelerates toward the end."""
    return t * (2 - t)


def ease_in_out(t):
    """Slow start and end, fast middle."""
    if t < 0.5:
        return 2 * t * t
    else:
        return -1 + (2 - 2 * t) * t + 1


def bounce(t):
    """Elastic bounce effect using the standard bounce easing curve."""
    # Bounce uses a piecewise quadratic function
    if t < 1 / 2.75:
        return 7.5625 * t * t
    elif t < 2 / 2.75:
        t -= 1.5 / 2.75
        return 7.5625 * t * t + 0.75
    elif t < 2.5 / 2.75:
        t -= 2.25 / 2.75
        return 7.5625 * t * t + 0.9375
    else:
        t -= 2.625 / 2.75
        return 7.5625 * t * t + 0.984375


def ease_in_cubic(t):
    """Cubic ease-in — stronger acceleration."""
    return t * t * t


def ease_out_cubic(t):
    """Cubic ease-out — stronger deceleration."""
    return 1 - (1 - t) ** 3


def ease_in_out_cubic(t):
    """Cubic ease-in-out."""
    if t < 0.5:
        return 4 * t * t * t
    else:
        return 1 - (-2 * t + 2) ** 3 / 2


# Easing lookup table
EASINGS = {
    'linear': linear,
    'ease_in': ease_in,
    'ease_out': ease_out,
    'ease_in_out': ease_in_out,
    'bounce': bounce,
    'ease_in_cubic': ease_in_cubic,
    'ease_out_cubic': ease_out_cubic,
    'ease_in_out_cubic': ease_in_out_cubic,
}


def get_easing(name):
    """Get an easing function by name. Returns linear if not found."""
    return EASINGS.get(name, linear)
