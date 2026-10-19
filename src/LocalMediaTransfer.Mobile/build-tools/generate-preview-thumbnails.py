"""Generate small synthetic PNG thumbnails supported by both native image views."""
import base64
import json
from pathlib import Path
import struct
import zlib


def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xFFFFFFFF)


def thumbnail(sky):
    size = 240
    pixels = bytearray()
    for y in range(size):
        pixels.append(0)
        for x in range(size):
            color = sky
            if (x - 175) ** 2 + (y - 60) ** 2 < 26 ** 2:
                color = (255, 232, 175)
            if y > 90 + abs(x - 75) * 1.1:
                color = (24, 60, 81)
            if y > 170 + abs(x - 165) * 0.4:
                color = (169, 200, 178)
            pixels.extend(color)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
    data += chunk(b'IDAT', zlib.compress(pixels, 9)) + chunk(b'IEND', b'')
    return 'data:image/png;base64,' + base64.b64encode(data).decode('ascii')


colors = [(40, 96, 143), (82, 119, 102), (175, 114, 83), (126, 107, 156), (163, 131, 69), (83, 127, 145)]
output = Path(__file__).resolve().parent.parent / 'src' / 'dev' / 'preview' / 'thumbnails.json'
output.write_text(json.dumps([thumbnail(color) for color in colors], indent=2) + '\n', encoding='utf-8')
print('Generated six TEST-only synthetic PNG thumbnails.')
