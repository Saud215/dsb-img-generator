(() => {
    'use strict';

    // ─── DOM References ──────────────────────────────────────────────────────
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const browseBtn = document.getElementById('browse-btn');
    const statusEl = document.getElementById('status');
    const canvasSection = document.getElementById('canvas-section');
    const stitchCountEl = document.getElementById('stitch-count');
    const colorPicker = document.getElementById('color-picker');
    const downloadPngBtn = document.getElementById('download-png-btn');
    const downloadDstBtn = document.getElementById('download-dst-btn');
    const canvas = document.getElementById('stitch-canvas');
    const ctx = canvas.getContext('2d');

    let currentFileName = 'embroidery';

    // ─── Drag & Drop ────────────────────────────────────────────────────────
    ['dragenter', 'dragover'].forEach((evt) =>
        dropZone.addEventListener(evt, (e) => {
            e.preventDefault();
            dropZone.classList.add('drag-over');
        })
    );

    ['dragleave', 'drop'].forEach((evt) =>
        dropZone.addEventListener(evt, (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
        })
    );

    dropZone.addEventListener('drop', (e) => {
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
    });

    // Click / keyboard
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileInput.click();
        }
    });

    browseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        fileInput.click();
    });

    fileInput.addEventListener('change', () => {
        if (fileInput.files[0]) handleFile(fileInput.files[0]);
    });

    // ─── File Upload ─────────────────────────────────────────────────────────
    async function handleFile(file) {
        currentFileName = file.name.replace(/\.[^/.]+$/, "");
        showStatus('loading', `Parsing "${file.name}" …`);

        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await fetch('/upload', { method: 'POST', body: formData });
            const data = await res.json();

            if (!res.ok) throw new Error(data.error || 'Upload failed');
            if (!data.stitches || data.stitches.length < 2) {
                throw new Error('Not enough stitch data found in file.');
            }

            showStatus('success', `Loaded ${data.stitches.length.toLocaleString()} stitches from "${file.name}"`);
            renderStitches(data.stitches);
        } catch (err) {
            showStatus('error', err.message);
        }
    }

    // ─── Status Helpers ──────────────────────────────────────────────────────
    function showStatus(type, message) {
        statusEl.className = `status ${type}`;
        statusEl.textContent = message;
    }

    // ─── Canvas Rendering ────────────────────────────────────────────────────
    function renderStitches(stitches) {
        canvasSection.classList.remove('hidden');
        stitchCountEl.textContent = `${stitches.length.toLocaleString()} stitches`;

        // Compute bounding box
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const s of stitches) {
            if (s.x < minX) minX = s.x;
            if (s.y < minY) minY = s.y;
            if (s.x > maxX) maxX = s.x;
            if (s.y > maxY) maxY = s.y;
        }

        const designW = maxX - minX || 1;
        const designH = maxY - minY || 1;

        // Size canvas to fit container while preserving aspect ratio
        const containerWidth = canvas.parentElement.clientWidth - 32; // account for padding
        const aspect = designW / designH;
        const canvasW = containerWidth;
        const canvasH = containerWidth / aspect;

        // High-DPI support
        const dpr = window.devicePixelRatio || 1;
        canvas.width = canvasW * dpr;
        canvas.height = canvasH * dpr;
        canvas.style.width = canvasW + 'px';
        canvas.style.height = canvasH + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Clear
        ctx.fillStyle = '#12121f';
        ctx.fillRect(0, 0, canvasW, canvasH);

        // Compute scale & offset to center design with padding
        const padding = 30;
        const scaleX = (canvasW - padding * 2) / designW;
        const scaleY = (canvasH - padding * 2) / designH;
        const scale = Math.min(scaleX, scaleY);
        const offsetX = (canvasW - designW * scale) / 2;
        const offsetY = (canvasH - designH * scale) / 2;

        // Draw stitch lines
        ctx.lineWidth = 1.2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.strokeStyle = colorPicker.value;
        ctx.beginPath();

        for (let i = 0; i < stitches.length; i++) {
            const s = stitches[i];
            const px = (s.x - minX) * scale + offsetX;
            const py = (s.y - minY) * scale + offsetY;

            if (i === 0 || s.penUp) {
                ctx.moveTo(px, py);
            } else {
                ctx.lineTo(px, py);
            }
        }

        ctx.stroke();

        // Draw stitch points for small designs
        if (stitches.length < 500) {
            ctx.fillStyle = 'rgba(255,255,255,0.45)';
            for (const s of stitches) {
                const px = (s.x - minX) * scale + offsetX;
                const py = (s.y - minY) * scale + offsetY;
                ctx.beginPath();
                ctx.arc(px, py, 1.5, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    // ─── Resize Handler ────────────────────────────────────────────────────
    let lastStitches = null;
    const origRender = renderStitches;
    renderStitches = function (stitches) {
        lastStitches = stitches;
        origRender(stitches);
    };

    window.addEventListener('resize', () => {
        if (lastStitches) origRender(lastStitches);
    });
    colorPicker.addEventListener('input', () => {
        if (lastStitches) origRender(lastStitches);
    });

    // ─── Download Handlers ───────────────────────────────────────────────────
    downloadPngBtn.addEventListener('click', () => {
        const dataURL = canvas.toDataURL('image/png');
        downloadFile(dataURL, `${currentFileName}.png`);
    });

    downloadDstBtn.addEventListener('click', () => {
        if (!lastStitches || lastStitches.length === 0) return;
        const dstData = generateDST(lastStitches, colorPicker.value);
        const blob = new Blob([dstData], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        downloadFile(url, `${currentFileName}.dst`);
        URL.revokeObjectURL(url);
    });

    function downloadFile(url, filename) {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    // ─── DST Generation ──────────────────────────────────────────────────────
    function generateDST(stitches, hexColor) {
        // DST requires relative movements (dx, dy)
        const COMMAND_MASK = 0xFF;
        const STITCH = 0b00000011;
        const JUMP = 0b10000011;

        let dxRecords = [];

        const bit = (b) => 1 << b;
        const encodeRecord = (x, y, flags) => {
            y = -y; // Flipping Y for standard DST encoding
            let b0 = 0, b1 = 0, b2 = 0;
            if (flags === JUMP) b2 += bit(7);

            b2 += bit(0);
            b2 += bit(1);

            if (x > 40) { b2 += bit(2); x -= 81; }
            if (x < -40) { b2 += bit(3); x += 81; }
            if (x > 13) { b1 += bit(2); x -= 27; }
            if (x < -13) { b1 += bit(3); x += 27; }
            if (x > 4) { b0 += bit(2); x -= 9; }
            if (x < -4) { b0 += bit(3); x += 9; }
            if (x > 1) { b1 += bit(0); x -= 3; }
            if (x < -1) { b1 += bit(1); x += 3; }
            if (x > 0) { b0 += bit(0); x -= 1; }
            if (x < 0) { b0 += bit(1); x += 1; }

            // X must be 0 here

            if (y > 40) { b2 += bit(5); y -= 81; }
            if (y < -40) { b2 += bit(4); y += 81; }
            if (y > 13) { b1 += bit(5); y -= 27; }
            if (y < -13) { b1 += bit(4); y += 27; }
            if (y > 4) { b0 += bit(5); y -= 9; }
            if (y < -4) { b0 += bit(4); y += 9; }
            if (y > 1) { b1 += bit(7); y -= 3; }
            if (y < -1) { b1 += bit(6); y += 3; }
            if (y > 0) { b0 += bit(7); y -= 1; }
            if (y < 0) { b0 += bit(6); y += 1; }

            // Y must be 0 here

            return [b0, b1, b2];
        };

        const pushMovement = (dx, dy, isJump) => {
            // Maximum standard STITCH delta in a single 3-byte command is ±121
            // If the movement exceeds this, we need multiple jumps
            let remainingX = dx;
            let remainingY = dy;

            while (Math.abs(remainingX) > 121 || Math.abs(remainingY) > 121) {
                let stepX = Math.max(-121, Math.min(121, remainingX));
                let stepY = Math.max(-121, Math.min(121, remainingY));
                dxRecords.push(...encodeRecord(stepX, stepY, JUMP));
                remainingX -= stepX;
                remainingY -= stepY;
            }
            if (remainingX !== 0 || remainingY !== 0 || isJump) {
                dxRecords.push(...encodeRecord(remainingX, remainingY, isJump ? JUMP : STITCH));
            }
        };

        let lastX = 0;
        let lastY = 0;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

        // Process all stitch movements relative to each other
        for (let i = 0; i < stitches.length; i++) {
            const current = stitches[i];
            let dx = current.x - lastX;
            let dy = current.y - lastY;

            if (current.x < minX) minX = current.x;
            if (current.x > maxX) maxX = current.x;
            if (current.y < minY) minY = current.y;
            if (current.y > maxY) maxY = current.y;

            pushMovement(dx, dy, current.penUp);
            lastX = current.x;
            lastY = current.y;
        }

        // Add proper EOF marker for DST (0b11110011 -> 243 -> End sequence typically 00 00 F3)
        dxRecords.push(0, 0, 0xF3);

        // Build the 512-byte header with Extended Tajima info
        const header = new Uint8Array(512);
        // Fill header with spaces roughly (ASCII 0x20)
        header.fill(0x20);

        let boundsW = (maxX - minX) * 10;
        let boundsH = (maxY - minY) * 10;

        let headerStr = "";
        headerStr += `LA:${currentFileName.substring(0, 16).padEnd(16, " ")}\r`;
        headerStr += `ST:${String(stitches.length).padStart(7, " ")}\r`;
        headerStr += `CO:  0\r`; // No colour changes as requested single colour out
        headerStr += `+X:${String(Math.round(boundsW)).padStart(5, " ")}\r`;
        headerStr += `-X:    0\r`;
        headerStr += `+Y:${String(Math.round(boundsH)).padStart(5, " ")}\r`;
        headerStr += `-Y:    0\r`;
        headerStr += `AX:+    0\r`;
        headerStr += `AY:+    0\r`;
        headerStr += `MX:+    0\r`;
        headerStr += `MY:+    0\r`;
        headerStr += `PD:******\r`;
        headerStr += `TC:${hexColor},StyleColor,Unknown\r`; // extended header colour injection

        // write header string into uint8 array
        for (let i = 0; i < headerStr.length && i < 511; i++) {
            header[i] = headerStr.charCodeAt(i);
        }
        // Sub buffer end marker
        header[511] = 0x1A;

        // Combine header + commands
        const finalBuffer = new Uint8Array(512 + dxRecords.length);
        finalBuffer.set(header, 0);
        finalBuffer.set(new Uint8Array(dxRecords), 512);

        return finalBuffer;
    }
})();
