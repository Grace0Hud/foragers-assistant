// ── Sanitization helpers ──────────────────────────────────────────────────────

// Strip HTML tags and trim whitespace from any string input.
function sanitizeInput(value) {
    if (typeof value !== "string") return "";
    const temp = document.createElement("div");
    temp.textContent = value;
    return temp.innerHTML.trim();
}

// Validate a single tag: letters only, 1–128 chars.
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


// ── Tag pill management ───────────────────────────────────────────────────────

const MAX_TAGS = 10;
let tags = [];  // current list of validated tags

// Re-render all pills in the pill box and sync the hidden input.
function renderTags() {
    const box   = document.getElementById("tagPillBox");
    const input = document.getElementById("tagTextInput");

    // Remove all existing pills (keep the text input)
    box.querySelectorAll(".tag-pill").forEach(el => el.remove());

    tags.forEach((tag, index) => {
        const pill = document.createElement("span");
        pill.className = "tag-pill";
        pill.innerHTML = `${tag} <button type="button" aria-label="Remove ${tag}">&times;</button>`;
        pill.querySelector("button").addEventListener("click", () => {
            tags.splice(index, 1);
            renderTags();
        });
        box.insertBefore(pill, input);
    });

    // Sync hidden field
    document.getElementById("tagsHidden").value = tags.join(",");

    // Hide text input if at limit
    input.style.display = tags.length >= MAX_TAGS ? "none" : "";
    input.placeholder = tags.length === 0
        ? "Type a tag and press Enter or comma…"
        : "Add another tag…";
}

// Attempt to add a tag from the current text input value.
function addTagFromInput() {
    const input    = document.getElementById("tagTextInput");
    const raw      = sanitizeInput(input.value).toLowerCase().replace(/,/g, "").trim();

    if (!raw) return;

    if (!validateTag(raw)) {
        // Flash the border red briefly to signal invalid input
        input.style.borderBottom = "2px solid #C06E52";
        setTimeout(() => input.style.borderBottom = "", 1000);
        input.value = "";
        return;
    }

    if (tags.includes(raw)) {
        input.value = "";
        return;
    }

    if (tags.length >= MAX_TAGS) {
        input.value = "";
        return;
    }

    tags.push(raw);
    input.value = "";
    renderTags();
}

// Pre-populate pills if the form is re-rendered with previous_tags (on error).
function initTagsFromHidden() {
    const hidden = document.getElementById("tagsHidden");
    if (!hidden || !hidden.value) return;
    hidden.value.split(",").forEach(t => {
        const clean = t.trim().toLowerCase();
        if (clean && validateTag(clean) && !tags.includes(clean)) {
            tags.push(clean);
        }
    });
    renderTags();
}


// ── EXIF GPS extraction ───────────────────────────────────────────────────────

function extractExifGps(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();

        reader.onload = function (e) {
            try {
                const buf  = e.target.result;
                const view = new DataView(buf);

                if (view.getUint16(0) !== 0xFFD8) { resolve(null); return; }

                let offset = 2;
                while (offset < view.byteLength - 2) {
                    const marker = view.getUint16(offset);
                    offset += 2;

                    if (marker === 0xFFE1) {
                        const exifStr = String.fromCharCode(
                            view.getUint8(offset + 2), view.getUint8(offset + 3),
                            view.getUint8(offset + 4), view.getUint8(offset + 5)
                        );
                        if (exifStr !== "Exif") { resolve(null); return; }

                        const tiffStart = offset + 8;
                        const endian    = view.getUint16(tiffStart);
                        const littleEnd = (endian === 0x4949);

                        const getUint16 = (o) => view.getUint16(tiffStart + o, littleEnd);
                        const getUint32 = (o) => view.getUint32(tiffStart + o, littleEnd);

                        const ifd0Offset = getUint32(4);
                        const ifd0Count  = getUint16(ifd0Offset);
                        let   gpsIfdOffset = null;

                        for (let i = 0; i < ifd0Count; i++) {
                            const entryOffset = ifd0Offset + 2 + i * 12;
                            if (getUint16(entryOffset) === 0x8825) {
                                gpsIfdOffset = getUint32(entryOffset + 8);
                                break;
                            }
                        }

                        if (gpsIfdOffset === null) { resolve(null); return; }

                        const gpsCount = getUint16(gpsIfdOffset);
                        const gps = {};

                        for (let i = 0; i < gpsCount; i++) {
                            const entryOffset = gpsIfdOffset + 2 + i * 12;
                            const tag    = getUint16(entryOffset);
                            const valOff = entryOffset + 8;

                            if (tag === 1 || tag === 3) {
                                gps[tag] = String.fromCharCode(view.getUint8(tiffStart + getUint32(valOff)));
                            }
                            if (tag === 2 || tag === 4) {
                                const dataOffset = getUint32(valOff);
                                const deg = getUint32(dataOffset)      / getUint32(dataOffset + 4);
                                const min = getUint32(dataOffset + 8)  / getUint32(dataOffset + 12);
                                const sec = getUint32(dataOffset + 16) / getUint32(dataOffset + 20);
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

                    if ((marker & 0xFF00) !== 0xFF00) { resolve(null); return; }
                    offset += view.getUint16(offset);
                }
                resolve(null);
            } catch (_) { resolve(null); }
        };

        reader.onerror = () => resolve(null);
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


// ── Page init ─────────────────────────────────────────────────────────────────

$(function () {

    // Restore pills if form was re-rendered after a validation error
    initTagsFromHidden();

    // Click on the pill box focuses the text input
    $("#tagPillBox").on("click", function () {
        $("#tagTextInput").focus();
    });

    // Add tag on Enter or comma
    $("#tagTextInput").on("keydown", function (e) {
        if (e.key === "Enter") {
            e.preventDefault();  // don't submit the form
            addTagFromInput();
        }
    });

    $("#tagTextInput").on("input", function () {
        // Add tag when user types a comma
        if (this.value.includes(",")) {
            addTagFromInput();
        }
    });

    // EXIF: read GPS as soon as a file is chosen
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

    // Submit: validate tags, populate geo fields, then post
    $("#uploadForm").on("submit", async function (e) {
        e.preventDefault();

        // Flush any half-typed tag in the input box
        addTagFromInput();

        if (tags.length === 0) {
            // Show inline error without a page reload
            if (!$("#tagError").length) {
                $("<p id='tagError' style='color:#C06E52; font-weight:700;'>Please add at least one tag.</p>")
                    .insertAfter("#tagPillBox");
            }
            return;
        }
        $("#tagError").remove();

        const statusEl = $("#geoStatus");

        if (exifCoords) {
            $("#latitude").val(exifCoords.latitude);
            $("#longitude").val(exifCoords.longitude);
            $("#geo_source").val("exif");
        } else {
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
                statusEl.text("Location unavailable — uploading without coordinates.");
            }
        }

        // Sanitize manual location label
        const labelInput = $("#location_label");
        labelInput.val(sanitizeInput(labelInput.val()));

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

    if (!tag) { status.text("Enter a tag to search."); return; }

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
