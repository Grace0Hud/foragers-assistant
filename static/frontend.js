// ── Sanitization helpers ──────────────────────────────────────────────────────

// Strip HTML tags and trim whitespace from any string input.
function sanitizeInput(value) {
    if (typeof value !== "string") return "";
    const temp = document.createElement("div");
    temp.textContent = value;
    return temp.innerHTML.trim();
}

// Validate a search tag: letters only, 1–128 chars.
function validateTag(tag) {
    if (!tag || tag.length === 0 || tag.length > 128) return false;
    return /^[A-Za-z]+$/.test(tag);
}

// Validate a coordinate value is a finite number within range.
function validateCoordinate(lat, lon) {
    const la = parseFloat(lat);
    const lo = parseFloat(lon);
    return (
        isFinite(la) && isFinite(lo) &&
        la >= -90  && la <= 90 &&
        lo >= -180 && lo <= 180
    );
}


// ── EXIF GPS extraction ───────────────────────────────────────────────────────

/**
 * Attempt to read GPS coordinates from a JPEG file's EXIF data.
 * Returns { latitude, longitude } or null if not found / not a JPEG.
 *
 * We parse the raw binary ourselves — no external library needed.
 * EXIF is only present in JPEG (FF D8) files.
 */
function extractExifGps(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();

        reader.onload = function (e) {
            try {
                const buf  = e.target.result;
                const view = new DataView(buf);

                // Must start with JPEG SOI marker FF D8
                if (view.getUint16(0) !== 0xFFD8) { resolve(null); return; }

                let offset = 2;
                while (offset < view.byteLength - 2) {
                    const marker = view.getUint16(offset);
                    offset += 2;

                    // APP1 marker (0xFFE1) contains EXIF
                    if (marker === 0xFFE1) {
                        const segLen  = view.getUint16(offset);
                        // Check for "Exif\0\0" header
                        const exifStr = String.fromCharCode(
                            view.getUint8(offset + 2),
                            view.getUint8(offset + 3),
                            view.getUint8(offset + 4),
                            view.getUint8(offset + 5)
                        );
                        if (exifStr !== "Exif") { resolve(null); return; }

                        // TIFF header starts at offset + 8 (after length word + "Exif\0\0")
                        const tiffStart = offset + 8;
                        const endian    = view.getUint16(tiffStart);
                        const littleEnd = (endian === 0x4949); // "II" = little-endian

                        const getUint16 = (o) => view.getUint16(tiffStart + o, littleEnd);
                        const getUint32 = (o) => view.getUint32(tiffStart + o, littleEnd);

                        // Walk IFD0
                        const ifd0Offset = getUint32(4);
                        const ifd0Count  = getUint16(ifd0Offset);
                        let   gpsIfdOffset = null;

                        for (let i = 0; i < ifd0Count; i++) {
                            const entryOffset = ifd0Offset + 2 + i * 12;
                            const tag = getUint16(entryOffset);
                            if (tag === 0x8825) { // GPSInfo IFD pointer
                                gpsIfdOffset = getUint32(entryOffset + 8);
                                break;
                            }
                        }

                        if (gpsIfdOffset === null) { resolve(null); return; }

                        // Read GPS IFD entries
                        const gpsCount = getUint16(gpsIfdOffset);
                        const gps = {};

                        for (let i = 0; i < gpsCount; i++) {
                            const entryOffset = gpsIfdOffset + 2 + i * 12;
                            const tag    = getUint16(entryOffset);
                            const type   = getUint16(entryOffset + 2);
                            const count  = getUint32(entryOffset + 4);
                            const valOff = entryOffset + 8;

                            // Tags: 1=LatRef, 2=Lat, 3=LonRef, 4=Lon
                            if (tag === 1 || tag === 3) {
                                gps[tag] = String.fromCharCode(view.getUint8(tiffStart + getUint32(valOff)));
                            }
                            if (tag === 2 || tag === 4) {
                                // RATIONAL array: degrees, minutes, seconds
                                const dataOffset = getUint32(valOff);
                                const deg = getUint32(dataOffset)     / getUint32(dataOffset + 4);
                                const min = getUint32(dataOffset + 8) / getUint32(dataOffset + 12);
                                const sec = getUint32(dataOffset + 16)/ getUint32(dataOffset + 20);
                                gps[tag] = deg + min / 60 + sec / 3600;
                            }
                        }

                        if (gps[2] !== undefined && gps[4] !== undefined) {
                            let lat = gps[2];
                            let lon = gps[4];
                            if (gps[1] === "S") lat = -lat;
                            if (gps[3] === "W") lon = -lon;
                            resolve({ latitude: lat.toFixed(7), longitude: lon.toFixed(7) });
                            return;
                        }

                        resolve(null);
                        return;
                    }

                    // Skip non-APP1 segments
                    if ((marker & 0xFF00) !== 0xFF00) { resolve(null); return; }
                    offset += view.getUint16(offset);
                }
                resolve(null);
            } catch (_) {
                resolve(null);
            }
        };

        reader.onerror = () => resolve(null);
        // Read only the first 128 KB — EXIF is always near the start of the file
        reader.readAsArrayBuffer(file.slice(0, 131072));
    });
}


// ── Browser geolocation ───────────────────────────────────────────────────────

function getBrowserLocation() {
    return new Promise((resolve) => {
        if (!navigator.geolocation) { resolve(null); return; }
        navigator.geolocation.getCurrentPosition(
            (pos) => resolve({
                latitude:  pos.coords.latitude.toFixed(7),
                longitude: pos.coords.longitude.toFixed(7)
            }),
            () => resolve(null),
            { timeout: 8000 }
        );
    });
}


// ── Upload form: attach geo data before submit ────────────────────────────────

$(function () {

    // When the user picks a file, immediately try to extract EXIF GPS.
    // We store the result so we don't re-read the file on submit.
    let exifCoords = null;

    $("#imageInput").on("change", async function () {
        const file = this.files[0];
        if (!file) return;
        exifCoords = await extractExifGps(file);
        if (exifCoords) {
            $("#geoStatus").text(
                `📍 GPS found in photo (${exifCoords.latitude}, ${exifCoords.longitude})`
            );
        } else {
            $("#geoStatus").text("No GPS data in photo — will try device location on upload.");
        }
    });

    // On submit: populate hidden fields, then let the form post normally.
    $("#uploadForm").on("submit", async function (e) {
        e.preventDefault();

        const statusEl = $("#geoStatus");

        if (exifCoords) {
            // Use coordinates already read from EXIF
            $("#latitude").val(exifCoords.latitude);
            $("#longitude").val(exifCoords.longitude);
            $("#geo_source").val("exif");

        } else {
            // Fall back to browser geolocation
            statusEl.text("Requesting device location…");
            const browserCoords = await getBrowserLocation();

            if (browserCoords) {
                $("#latitude").val(browserCoords.latitude);
                $("#longitude").val(browserCoords.longitude);
                $("#geo_source").val("browser");
                statusEl.text(
                    `📍 Using device location (${browserCoords.latitude}, ${browserCoords.longitude})`
                );
            } else {
                // Neither source worked — submit without coordinates
                statusEl.text("Location unavailable — uploading without coordinates.");
            }
        }

        // Sanitize the manual location label before submission
        const labelInput = $("#location_label");
        const sanitized  = sanitizeInput(labelInput.val());
        labelInput.val(sanitized);

        // Submit the form
        this.submit();
    });


    // ── Gallery search ────────────────────────────────────────────────────────

    $("#searchForm").on("submit", function (e) {
        e.preventDefault();
        const tag = $("#tag_input").val().trim();
        searchByTag(tag);
    });
});


// ── Gallery search function ───────────────────────────────────────────────────

async function searchByTag(tag) {
    const status = $("#searchStatus");
    const grid   = $("#resultsGrid");

    status.text("");
    grid.empty();

    if (!tag) {
        status.text("Enter a tag to search.");
        return;
    }

    const sanitized = sanitizeInput(tag).toLowerCase();

    if (!validateTag(sanitized)) {
        status.text("Invalid tag. Tags must contain only letters (A–Z) and be 1–128 characters long.");
        return;
    }

    status.text("Searching...");

    try {
        const response = await fetch(`/gallery/search?tag=${encodeURIComponent(sanitized)}`);

        if (!response.ok) { status.text("Search failed."); return; }

        const data = await response.json();

        if (!data.images || data.images.length === 0) {
            status.text(`No images found for "${sanitized}".`);
            return;
        }

        status.text(`Found ${data.images.length} image(s) for "${sanitized}".`);

        const html = data.images.map(filename =>
            `<img src="/uploads/${encodeURIComponent(filename)}" alt="Tagged ${sanitized}">`
        ).join("");

        grid.html(html);

    } catch (error) {
        console.error(error);
        status.text("Network error occurred.");
    }
}
