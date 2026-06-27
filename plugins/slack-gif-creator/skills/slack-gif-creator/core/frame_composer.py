"""
Frame Composer — Layer composition and layout for GIF frames.

Handles background rendering, gradient creation, and text layer composition.

Usage:
    from frame_composer import FrameComposer

    composer = FrameComposer(width=480, height=270, bg_color=(20, 20, 19))
    composer.add_gradient_bg(top_color=(20, 20, 19), bottom_color=(40, 40, 39))
    composer.add_text("Title", x=240, y=100, font=font, color=(217, 119, 87), anchor="center")
    frame = composer.render()
"""

from PIL import Image, ImageDraw, ImageFont, ImageChops
import math


class FrameComposer:
    """Composes a single frame with layered elements and backgrounds."""

    def __init__(self, width=480, height=270, bg_color=(20, 20, 19)):
        self.width = width
        self.height = height
        self.bg_color = bg_color
        self.layers = []  # List of (draw_fn, z_order)

    def add_solid_bg(self, color):
        """Add a solid color background."""
        self.layers.append(('bg', {'type': 'solid', 'color': color}, 0))

    def add_gradient_bg(self, top_color, bottom_color, direction='vertical'):
        """Add a gradient background.

        Args:
            top_color: RGB tuple for top/start color
            bottom_color: RGB tuple for bottom/end color
            direction: 'vertical' or 'horizontal'
        """
        self.layers.append(('bg', {
            'type': 'gradient',
            'color1': top_color,
            'color2': bottom_color,
            'direction': direction,
        }, 0))

    def add_text(self, text, x, y, font=None, color=(255, 255, 255),
                 anchor="center", z=10):
        """Add a text layer.

        Args:
            text: Text string
            x, y: Position
            font: PIL ImageFont object
            color: RGB tuple
            anchor: Text anchor - center, left, right
            z: Z-order (higher = drawn on top)
        """
        self.layers.append(('text', {
            'text': text,
            'x': x,
            'y': y,
            'font': font,
            'color': color,
            'anchor': anchor,
        }, z))

    def add_shape(self, shape_type, points, fill=None, outline=None,
                  width=1, z=5):
        """Add a shape layer.

        Args:
            shape_type: 'rectangle', 'ellipse', 'polygon', 'line'
            points: Shape coordinates
            fill: Fill color (RGB tuple)
            outline: Outline color (RGB tuple)
            width: Line width
            z: Z-order
        """
        self.layers.append(('shape', {
            'type': shape_type,
            'points': points,
            'fill': fill,
            'outline': outline,
            'width': width,
        }, z))

    def add_image(self, img, x, y, mask=None, z=5):
        """Add an image layer at the specified position.

        Args:
            img: PIL Image object
            x, y: Position to paste at
            mask: Optional transparency mask
            z: Z-order
        """
        self.layers.append(('image', {
            'img': img,
            'x': x,
            'y': y,
            'mask': mask,
        }, z))

    def render(self):
        """Render all layers and return a PIL Image."""
        # Sort layers by z-order
        sorted_layers = sorted(self.layers, key=lambda l: l[2])

        # Create base image
        img = Image.new('RGB', (self.width, self.height), self.bg_color)
        draw = ImageDraw.Draw(img)

        for layer_name, props, z in sorted_layers:
            if layer_name == 'bg':
                self._draw_bg(img, draw, props)
            elif layer_name == 'text':
                self._draw_text(img, draw, props)
            elif layer_name == 'shape':
                self._draw_shape(img, draw, props)
            elif layer_name == 'image':
                self._draw_image(img, props)

        return img

    def _draw_bg(self, img, draw, props):
        """Draw background layer."""
        if props['type'] == 'solid':
            draw.rectangle([(0, 0), (self.width, self.height)],
                          fill=props['color'])
        elif props['type'] == 'gradient':
            direction = props.get('direction', 'vertical')
            c1 = props['color1']
            c2 = props['color2']

            if direction == 'vertical':
                for y in range(self.height):
                    ratio = y / max(self.height - 1, 1)
                    r = int(c1[0] * (1 - ratio) + c2[0] * ratio)
                    g = int(c1[1] * (1 - ratio) + c2[1] * ratio)
                    b = int(c1[2] * (1 - ratio) + c2[2] * ratio)
                    draw.line([(0, y), (self.width, y)], fill=(r, g, b))
            else:  # horizontal
                for x in range(self.width):
                    ratio = x / max(self.width - 1, 1)
                    r = int(c1[0] * (1 - ratio) + c2[0] * ratio)
                    g = int(c1[1] * (1 - ratio) + c2[1] * ratio)
                    b = int(c1[2] * (1 - ratio) + c2[2] * ratio)
                    draw.line([(x, 0), (x, self.height)], fill=(r, g, b))

    def _draw_text(self, img, draw, props):
        """Draw text layer."""
        anchor = props.get('anchor', 'center')
        draw.text(
            (props['x'], props['y']),
            props['text'],
            fill=props['color'],
            font=props.get('font'),
            anchor=anchor,
        )

    def _draw_shape(self, img, draw, props):
        """Draw shape layer."""
        shape_type = props['type']
        points = props['points']
        fill = props.get('fill')
        outline = props.get('outline')
        width = props.get('width', 1)

        if shape_type == 'rectangle':
            draw.rectangle(points, fill=fill, outline=outline, width=width)
        elif shape_type == 'ellipse':
            draw.ellipse(points, fill=fill, outline=outline, width=width)
        elif shape_type == 'polygon':
            draw.polygon(points, fill=fill, outline=outline, width=width)
        elif shape_type == 'line':
            draw.line(points, fill=outline or fill, width=width)

    def _draw_image(self, img, props):
        """Draw image layer."""
        src = props['img']
        x, y = props['x'], props['y']
        mask = props.get('mask')
        img.paste(src, (x, y), mask=mask)
