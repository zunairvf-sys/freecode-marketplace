"""
GifBuilder — Main GIF builder with frame rendering and animation support.

Usage:
    from gif_builder import GifBuilder

    builder = GifBuilder(width=480, height=270, fps=24)
    builder.add_text_animation(
        text="Hello!", x=240, y=135,
        font_path="font.ttf", font_size=48,
        color=(217, 119, 87),
        animation="fade_in", duration=30
    )
    builder.save("output.gif", optimization_passes=2)
"""

from PIL import Image, ImageDraw, ImageFont
import os
import time


class GifBuilder:
    """Builds animated GIFs with text animations and smooth transitions."""

    def __init__(self, width=480, height=270, fps=24, bg_color=(20, 20, 19)):
        self.width = width
        self.height = height
        self.fps = fps
        self.bg_color = bg_color
        self.frame_duration = int(1000 / fps)  # ms per frame
        self.animations = []
        self.frames = []

    def add_text_animation(self, text, x, y, font=None, font_path=None,
                           font_size=36, color=(255, 255, 255),
                           animation="fade_in", duration=30, anchor="center"):
        """Add a text animation to the GIF.

        Args:
            text: Text string to animate
            x, y: Position coordinates
            font: PIL ImageFont object (or None to use default)
            font_path: Path to font file (used if font is None)
            font_size: Font size in pixels (used if font is None)
            color: RGB tuple for text color
            animation: Animation type - fade_in, typewriter, bounce, scale, slide
            duration: Duration in frames
            anchor: Text anchor - center, left, right
        """
        if font is None:
            if font_path:
                font = ImageFont.truetype(font_path, font_size)
            else:
                font = ImageFont.load_default()

        self.animations.append({
            'text': text,
            'x': x,
            'y': y,
            'font': font,
            'color': color,
            'animation': animation,
            'duration': duration,
            'anchor': anchor,
            'font_size': font_size,
        })

    def add_background_color(self, color):
        """Override the background color."""
        self.bg_color = color

    def build(self):
        """Render all frames for all animations."""
        total_frames = max(
            (anim['duration'] for anim in self.animations), default=1
        )

        # Import easing functions
        script_dir = os.path.dirname(__file__)
        import sys
        sys.path.insert(0, script_dir)
        from easing import ease_in, ease_out, ease_in_out, bounce

        easings = {
            'ease_in': ease_in,
            'ease_out': ease_out,
            'ease_in_out': ease_in_out,
            'bounce': bounce,
        }

        for frame_idx in range(total_frames):
            img = Image.new('RGB', (self.width, self.height), self.bg_color)
            draw = ImageDraw.Draw(img)

            for anim in self.animations:
                dur = anim['duration']
                if frame_idx >= dur:
                    continue

                t = frame_idx / max(dur - 1, 1)  # normalize to 0-1
                anim_type = anim['animation']

                # Calculate opacity based on animation type
                if anim_type == 'fade_in':
                    opacity = t
                    draw.text((anim['x'], anim['y']), anim['text'],
                              fill=self._fade_color(anim['color'], opacity),
                              font=anim['font'], anchor=anim['anchor'])

                elif anim_type == 'typewriter':
                    chars = int(len(anim['text']) * t) + 1
                    partial = anim['text'][:chars]
                    draw.text((anim['x'], anim['y']), partial,
                              fill=anim['color'], font=anim['font'],
                              anchor=anim['anchor'])

                elif anim_type == 'bounce':
                    ease_fn = easings.get('bounce', bounce)
                    bounce_t = ease_fn(t)
                    y_offset = int((1 - bounce_t) * 100)
                    draw.text((anim['x'], anim['y'] - y_offset), anim['text'],
                              fill=anim['color'], font=anim['font'],
                              anchor=anim['anchor'])

                elif anim_type == 'scale':
                    ease_fn = easings.get('ease_out', ease_out)
                    scale = ease_fn(t)
                    scaled_size = max(1, int(anim['font_size'] * scale))
                    scaled_font = ImageFont.truetype(
                        anim['font'].path, scaled_size
                        if hasattr(anim['font'], 'path')
                        else scaled_size
                    ) if hasattr(anim['font'], 'path') else anim['font']
                    draw.text((anim['x'], anim['y']), anim['text'],
                              fill=anim['color'], font=scaled_font,
                              anchor=anim['anchor'])

                elif anim_type == 'slide':
                    ease_fn = easings.get('ease_out', ease_out)
                    slide_t = ease_fn(t)
                    x_offset = int((1 - slide_t) * 200)
                    draw.text((anim['x'] - x_offset, anim['y']), anim['text'],
                              fill=anim['color'], font=anim['font'],
                              anchor=anim['anchor'])

                else:
                    # Default: just draw the text
                    draw.text((anim['x'], anim['y']), anim['text'],
                              fill=anim['color'], font=anim['font'],
                              anchor=anim['anchor'])

            self.frames.append(img)

        return self.frames

    def _fade_color(self, color, opacity):
        """Return a faded version of the color based on opacity (0-1)."""
        bg = self.bg_color
        return tuple(int(c * opacity + bc * (1 - opacity))
                     for c, bc in zip(color, bg))

    def save(self, path, optimization_passes=2):
        """Build frames and save as optimized GIF.

        Args:
            path: Output file path
            optimization_passes: Number of optimization passes (0-3, more = smaller file)
        """
        if not self.frames:
            self.build()

        if not self.frames:
            raise ValueError("No frames to save. Add animations first.")

        # Convert to mode that GIF supports
        gif_frames = []
        for frame in self.frames:
            if frame.mode != 'P':
                frame = frame.convert('P', palette=Image.ADAPTIVE)
            gif_frames.append(frame)

        # Save with optimization
        if gif_frames:
            gif_frames[0].save(
                path,
                save_all=True,
                append_images=gif_frames[1:],
                duration=self.frame_duration,
                loop=0,
                optimize=optimization_passes > 0,
            )

        # Clean up memory
        for frame in self.frames:
            frame.close()
        self.frames = gif_frames

        # Optional: run imageio optimization if available
        if optimization_passes > 1:
            self._optimize_gif(path, optimization_passes)

        size = os.path.getsize(path)
        print(f"Saved {path} ({size / 1024:.1f} KB)")
        return path

    def _optimize_gif(self, path, passes):
        """Try to optimize GIF further using imageio if available."""
        try:
            import imageio.v3 as iio
            frames = iio.imread(path, plugin='Pillow')
            iio.imwrite(
                path, frames, plugin='Pillow',
                duration=self.frame_duration,
                loop=0,
                fps=self.fps,
                optimize=3,
            )
            size = os.path.getsize(path)
            print(f"Optimized {path} ({size / 1024:.1f} KB)")
        except ImportError:
            print("Tip: pip install imageio for better GIF optimization")
        except Exception as e:
            print(f"Optimization skipped: {e}")
