const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer configuration
const upload = multer({ dest: uploadsDir });

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// ─── DSB Binary Parser ──────────────────────────────────────────────────────

/**
 * Parse a DSB embroidery file buffer.
 *
 * DSB format stores stitch data as coordinate deltas (signed bytes),
 * very similar to the DST format.  Each stitch record is 3 bytes:
 *   byte 0 : dy (signed, positive = down)
 *   byte 1 : dx (signed, positive = right)
 *   byte 2 : flags
 *
 * Flag bits:
 *   0x80 – end of file / stop
 *   0x40 – color change (pen up, move, pen down with new color)
 *   0x20 – jump / trim  (pen up move)
 *
 * A 512-byte header block is skipped (common in DSB/DST family).
 */
function parseDSB(buffer) {
  const HEADER_SIZE = 512;
  const stitches = [];

  // If the file is too small, try without header
  let offset = buffer.length > HEADER_SIZE + 3 ? HEADER_SIZE : 0;

  let x = 0;
  let y = 0;
  let colorIndex = 0;

  // First point
  stitches.push({ x, y, penUp: false, colorIndex });

  while (offset + 2 < buffer.length) {
    const ctrl = buffer[offset];
    const b1 = buffer[offset + 1];
    const b2 = buffer[offset + 2];
    offset += 3;

    // End-of-file marker
    if (ctrl === 0xF8) {
      break;
    }

    let dy = b1;
    let dx = b2;

    if ((ctrl & 0x40) !== 0) dy = -dy;
    if ((ctrl & 0x20) !== 0) dx = -dx;

    dy = -dy; // DST format Y axis inversion for screen coordinates

    const cmd = ctrl & 0b11111;
    let isJump = false;
    let isColorChange = false;

    if (cmd === 1 || ctrl === 0xE7) {
      isJump = true;
    } else if (ctrl === 0xE8 || (ctrl >= 0xE9 && ctrl < 0xF8)) {
      isColorChange = true;
    }

    if (isColorChange) {
      colorIndex++;
    }

    x += dx;
    y += dy;

    stitches.push({
      x,
      y, // y is screen coordinate 
      penUp: isJump || isColorChange,
      colorIndex,
    });
  }

  return stitches;
}

// ─── Upload Endpoint ─────────────────────────────────────────────────────────

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const filePath = req.file.path;

  try {
    const buffer = fs.readFileSync(filePath);
    const stitches = parseDSB(buffer);

    // Clean up temp file
    fs.unlinkSync(filePath);

    return res.json({ stitches });
  } catch (err) {
    // Clean up on error too
    try { fs.unlinkSync(filePath); } catch (_) { /* ignore */ }
    console.error('Parse error:', err);
    return res.status(500).json({ error: 'Failed to parse DSB file' });
  }
});

// ─── Start Server ────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`✨ DSB Viewer running at http://localhost:${PORT}`);
});
