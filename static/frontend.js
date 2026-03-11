// ── Sanitization helpers ──────────────────────────────────────────────────────

function sanitizeInput(value) {
    if (typeof value !== "string") return "";
    const temp = document.createElement("div");
    temp.textContent = value;
    return temp.innerHTML.trim();
}

function validateTag(tag) {
    if (!tag || tag.length === 0 || tag.length > 128) return false;
    return /^[A-Za-z]+$/.test(tag);
}


// ── Upload form: tag pill management ─────────────────────────────────────────

const MAX_UPLOAD_TAGS = 10;
let uploadTags = [];

function renderUploadTags() {
    const box   = document.getElementById("tagPillBox");
    const input = document.getElementById("tagTextInput");
    if (!box) return;

    box.querySelectorAll(".tag-pill").forEach(el => el.remove());

    uploadTags.forEach((tag, index) => {
        const pill = document.createElement("span");
        pill.className = "tag-pill";
        pill.innerHTML = `${tag} <button type="button" aria-label="Remove ${tag}">&times;</button>`;
        pill.querySelector("button").addEventListener("click", () => {
            uploadTags.splice(index, 1);
            renderUploadTags();
        });
        box.insertBefore(pill, input);
    });

    document.getElementById("tagsHidden").value = uploadTags.join(",");
    input.style.display = uploadTags.length >= MAX_UPLOAD_TAGS ? "none" : "";
    input.placeholder = uploadTags.length === 0
        ? "Type a tag and press Enter or comma…"
        : "Add another tag…";
}

function addUploadTagFromInput() {
    const input = document.getElementById("tagTextInput");
    if (!input) return;
    const raw = sanitizeInput(input.value).toLowerCase().replace(/,/g, "").trim();
    if (!raw) return;
    if (!validateTag(raw)) {
        input.style.borderBottom = "2px solid #C06E52";
        setTimeout(() => input.style.borderBottom = "", 1000);
        input.value = "";
        return;
    }
    if (uploadTags.includes(raw) || uploadTags.length >= MAX_UPLOAD_TAGS) {
        input.value = "";
        return;
    }
    uploadTags.push(raw);
    input.value = "";
    renderUploadTags();
}

function initUploadTagsFromHidden() {
    const hidden = document.getElementById("tagsHidden");
    if (!hidden || !hidden.value) return;
    hidden.value.split(",").forEach(t => {
        const clean = t.trim().toLowerCase();
        if (clean && validateTag(clean) && !uploadTags.includes(clean)) {
            uploadTags.push(clean);
        }
    });
    renderUploadTags();
}


// ── Gallery: active search tags ───────────────────────────────────────────────

let activeTags = [];   // tags currently filtering the gallery

function renderActiveTags() {
    const container = $("#activeTags");
    container.empty();
    activeTags.forEach(tag => {
        const pill = $(`<span class="search-tag-pill">${tag} <button type="button" aria-label="Remove ${tag}">&times;</button></span>`);
        pill.find("button").on("click", () => {
            activeTags = activeTags.filter(t => t !== tag);
            renderActiveTags();
            if (activeTags.length > 0) runSearch();
            else {
                $("#resultsGrid").empty();
                $("#searchStatus").text("");
            }
        });
        container.append(pill);
    });
}

// Add a tag to the active search filter and re-run the search.
function addSearchTag(tag) {
    const clean = sanitizeInput(tag).toLowerCase();
    if (!validateTag(clean)) return;
    if (activeTags.includes(clean)) return;
    activeTags.push(clean);
    renderActiveTags();
    runSearch();
}


// ── Gallery: search & render ──────────────────────────────────────────────────

async function runSearch() {
    const status = $("#searchStatus");
    const grid   = $("#resultsGrid");

    status.text("Searching…");
    grid.empty();

    try {
        // Pass all active tags as repeated ?tags= params
        const params = activeTags.map(t => `tags=${encodeURIComponent(t)}`).join("&");
        const response = await fetch(`/gallery/search?${params}`);

        if (!response.ok) { status.text("Search failed."); return; }

        const data = await response.json();

        if (!data.images || data.images.length === 0) {
            status.text(`No images found for "${activeTags.join(" + ")}".`);
            return;
        }

        status.text(`Found ${data.images.length} image(s) for "${activeTags.join(" + ")}".`);

        data.images.forEach(item => {
            // Build tag strip preview (first 3 tags)
            const tagPills = (item.tags || []).slice(0, 3)
                .map(t => `<span class="card-tag">${t}</span>`).join("");

            const card = $(`
                <div class="grid-card" tabindex="0" role="button" aria-label="View details">
                    <img src="/uploads/${encodeURIComponent(item.image)}"
                         alt="Tagged ${(item.tags || []).join(', ')}">
                    <div class="card-tag-strip">${tagPills}</div>
                </div>
            `);

            card.on("click keydown", function (e) {
                if (e.type === "keydown" && e.key !== "Enter") return;
                openDetail(item);
            });

            grid.append(card);
        });

    } catch (err) {
        console.error(err);
        status.text("Network error occurred.");
    }
}


// ── Detail modal ──────────────────────────────────────────────────────────────

function openDetail(item) {
    const activeTagSet = new Set(activeTags);

    // Image
    $("#detailImg")
        .attr("src", `/uploads/${encodeURIComponent(item.image)}`)
        .attr("alt", (item.tags || []).join(", "));

    // Tags — clickable pills, highlighted if already in active search
    const tagsEl = $("#detailTags").empty();
    (item.tags || []).forEach(tag => {
        const pill = $(`<span class="detail-tag-pill${activeTagSet.has(tag) ? " active-tag" : ""}">${tag}</span>`);
        pill.on("click", () => {
            addSearchTag(tag);
            // Update highlight state without closing modal
            pill.addClass("active-tag");
        });
        tagsEl.append(pill);
    });

    // Location label and/or manual address (both optional)
    const locationText = [item.manual_address, item.location_label].filter(Boolean).join(" — ");
    if (locationText) {
        $("#detailLocationLabel").text(locationText);
        $("#detailLocationLabelRow").show();
    } else {
        $("#detailLocationLabelRow").hide();
    }

    // Coordinates with Google Maps directions link
    const geo = item.location_geo;
    if (geo && geo.latitude != null && geo.longitude != null) {
        const lat = geo.latitude;
        const lon = geo.longitude;
        const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
        $("#detailCoordsLink").attr("href", mapsUrl);
        $("#detailCoordsText").text(`${lat}, ${lon}`);
        $("#detailCoordsRow").show();
    } else {
        $("#detailCoordsRow").hide();
    }

    // Timestamp
    if (item.uploaded_at) {
        const d = new Date(item.uploaded_at);
        $("#detailUploadedAt").text(d.toLocaleString());
    } else {
        $("#detailUploadedAt").text("Unknown");
    }

    $("#detailOverlay").addClass("open");
    document.body.style.overflow = "hidden";
}

function closeDetail() {
    $("#detailOverlay").removeClass("open");
    document.body.style.overflow = "";
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
                        const littleEnd = view.getUint16(tiffStart) === 0x4949;
                        const getUint16 = o => view.getUint16(tiffStart + o, littleEnd);
                        const getUint32 = o => view.getUint32(tiffStart + o, littleEnd);
                        const ifd0Offset = getUint32(4);
                        const ifd0Count  = getUint16(ifd0Offset);
                        let gpsIfdOffset = null;
                        for (let i = 0; i < ifd0Count; i++) {
                            const eo = ifd0Offset + 2 + i * 12;
                            if (getUint16(eo) === 0x8825) { gpsIfdOffset = getUint32(eo + 8); break; }
                        }
                        if (gpsIfdOffset === null) { resolve(null); return; }
                        const gpsCount = getUint16(gpsIfdOffset);
                        const gps = {};
                        for (let i = 0; i < gpsCount; i++) {
                            const eo  = gpsIfdOffset + 2 + i * 12;
                            const tag = getUint16(eo);
                            const vo  = eo + 8;
                            if (tag === 1 || tag === 3)
                                gps[tag] = String.fromCharCode(view.getUint8(tiffStart + getUint32(vo)));
                            if (tag === 2 || tag === 4) {
                                const d = getUint32(vo);
                                gps[tag] = getUint32(d)/getUint32(d+4) + getUint32(d+8)/getUint32(d+12)/60 + getUint32(d+16)/getUint32(d+20)/3600;
                            }
                        }
                        if (gps[2] !== undefined && gps[4] !== undefined) {
                            let lat = gps[2], lon = gps[4];
                            if (gps[1] === "S") lat = -lat;
                            if (gps[3] === "W") lon = -lon;
                            resolve({ latitude: lat.toFixed(7), longitude: lon.toFixed(7) });
                            return;
                        }
                        resolve(null); return;
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
            pos => resolve({ latitude: pos.coords.latitude.toFixed(7), longitude: pos.coords.longitude.toFixed(7) }),
            ()  => resolve(null),
            { timeout: 8000 }
        );
    });
}


// ── Address geocoding via Nominatim (OpenStreetMap, free, no API key) ─────────

async function geocodeAddress(address) {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
    try {
        const res = await fetch(url, {
            headers: { "Accept-Language": "en", "User-Agent": "ForagersAssistant/1.0" }
        });
        const data = await res.json();
        if (data && data.length > 0) {
            return {
                latitude:  parseFloat(data[0].lat).toFixed(7),
                longitude: parseFloat(data[0].lon).toFixed(7)
            };
        }
        return null;
    } catch (_) {
        return null;
    }
}


// ── Page init ─────────────────────────────────────────────────────────────────

$(function () {

    // ── Upload page ───────────────────────────────────────────────────────────
    if (document.getElementById("tagPillBox")) {
        initUploadTagsFromHidden();

        $("#tagPillBox").on("click", () => $("#tagTextInput").focus());

        $("#tagTextInput").on("keydown", function (e) {
            if (e.key === "Enter") { e.preventDefault(); addUploadTagFromInput(); }
        }).on("input", function () {
            if (this.value.includes(",")) addUploadTagFromInput();
        });

        // ── Location mode toggle ──────────────────────────────────────────────
        $("input[name='location_mode']").on("change", function () {
            if (this.value === "auto") {
                $("#autoLocationSection").show();
                $("#manualLocationSection").hide();
            } else {
                $("#autoLocationSection").hide();
                $("#manualLocationSection").show();
                $("#geoStatus").text("");
            }
        });

        // Restore manual mode if form was re-rendered with a previous address
        if ($("#manual_address").val()) {
            $("#locModeManual").prop("checked", true).trigger("change");
        }

        let exifCoords = null;

        $("#imageInput").on("change", async function () {
            const file = this.files[0];
            if (!file) return;
            // Only attempt EXIF if in auto mode
            if ($("#locModeAuto").is(":checked")) {
                exifCoords = await extractExifGps(file);
                $("#geoStatus").text(exifCoords
                    ? `📍 GPS found in photo (${exifCoords.latitude}, ${exifCoords.longitude})`
                    : "No GPS data in photo — will try device location on upload."
                );
            }
        });

        $("#uploadForm").on("submit", async function (e) {
            e.preventDefault();
            addUploadTagFromInput();

            if (uploadTags.length === 0) {
                if (!$("#tagError").length)
                    $("<p id='tagError' style='color:#C06E52;font-weight:700;'>Please add at least one tag.</p>")
                        .insertAfter("#tagPillBox");
                return;
            }
            $("#tagError").remove();

            const mode = $("input[name='location_mode']:checked").val();

            if (mode === "manual") {
                // Geocode the address the user typed
                const address = sanitizeInput($("#manual_address").val().trim());
                if (address) {
                    $("#geoStatus").show().text("Looking up address…");
                    const coords = await geocodeAddress(address);
                    if (coords) {
                        $("#latitude").val(coords.latitude);
                        $("#longitude").val(coords.longitude);
                        $("#geo_source").val("address");
                        $("#geoStatus").text(`📍 Found: ${coords.latitude}, ${coords.longitude}`);
                    } else {
                        // Address not found — upload without coordinates
                        $("#latitude").val("");
                        $("#longitude").val("");
                        $("#geo_source").val("");
                        $("#geoStatus").show().text("Address not found — uploading without coordinates.");
                    }
                }
            } else {
                // Auto mode: EXIF first, then browser geolocation
                const statusEl = $("#geoStatus");
                if (exifCoords) {
                    $("#latitude").val(exifCoords.latitude);
                    $("#longitude").val(exifCoords.longitude);
                    $("#geo_source").val("exif");
                } else {
                    statusEl.text("Requesting device location…");
                    const bc = await getBrowserLocation();
                    if (bc) {
                        $("#latitude").val(bc.latitude);
                        $("#longitude").val(bc.longitude);
                        $("#geo_source").val("browser");
                        statusEl.text(`📍 Using device location (${bc.latitude}, ${bc.longitude})`);
                    } else {
                        statusEl.text("Location unavailable — uploading without coordinates.");
                    }
                }
            }

            const labelInput = $("#location_label");
            labelInput.val(sanitizeInput(labelInput.val()));
            this.submit();
        });
    }

    // ── Gallery page ──────────────────────────────────────────────────────────
    if (document.getElementById("searchForm")) {

        // Add tag from text input on Enter or comma
        $("#tag_input").on("keydown", function (e) {
            if (e.key === "Enter") {
                e.preventDefault();
                const val = $(this).val().trim();
                if (val) { addSearchTag(val); $(this).val(""); }
            }
        }).on("input", function () {
            if (this.value.includes(",")) {
                addSearchTag(this.value);
                $(this).val("");
            }
        });

        // Search button / form submit
        $("#searchForm").on("submit", function (e) {
            e.preventDefault();
            const val = $("#tag_input").val().trim();
            if (val) { addSearchTag(val); $("#tag_input").val(""); }
            else if (activeTags.length > 0) runSearch();
        });

        // Detail modal: close on overlay click or close button
        $("#detailOverlay").on("click", function (e) {
            if (e.target === this) closeDetail();
        });
        $("#detailClose").on("click", closeDetail);

        // Close modal on Escape key
        $(document).on("keydown", function (e) {
            if (e.key === "Escape") closeDetail();
        });
    }
});