// Sanitize a string for safe display/use: strips HTML tags and trims whitespace.
function sanitizeInput(value) {
    if (typeof value !== "string") return "";
    // Remove any HTML tags using a temporary DOM element
    const temp = document.createElement("div");
    temp.textContent = value;
    return temp.innerHTML.trim();
}

// Validate that a tag contains only letters (A–Z, a–z) and is within length bounds.
function validateTag(tag) {
    if (!tag || tag.length === 0 || tag.length > 128) return false;
    return /^[A-Za-z]+$/.test(tag);
}

// This function performs the search by tag
async function searchByTag(tag) {
    const status = $("#searchStatus");
    const grid = $("#resultsGrid");

    status.text("");
    grid.empty();

    if (!tag) {
        status.text("Enter a tag to search.");
        return;
    }

    // Client-side sanitization and validation
    const sanitized = sanitizeInput(tag).toLowerCase();

    if (!validateTag(sanitized)) {
        status.text("Invalid tag. Tags must contain only letters (A–Z) and be 1–128 characters long.");
        return;
    }

    status.text("Searching...");

    try {
        const response = await fetch(`/gallery/search?tag=${encodeURIComponent(sanitized)}`);

        if (!response.ok) {
            status.text("Search failed.");
            return;
        }

        const data = await response.json();

        if (!data.images || data.images.length === 0) {
            status.text(`No images found for "${sanitized}".`);
            return;
        }

        status.text(`Found ${data.images.length} image(s) for "${sanitized}".`);

        const html = data.images.map(filename => {
            // Encode filename to prevent injection via malicious filenames
            return `<img src="/uploads/${encodeURIComponent(filename)}" alt="Tagged ${sanitized}">`;
        }).join("");

        grid.html(html);

    } catch (error) {
        console.error(error);
        status.text("Network error occurred.");
    }
}

// Run when page loads
$(function () {
    $("#searchForm").on("submit", function (e) {
        e.preventDefault();  // prevent page reload

        const tag = $("#tag_input").val().trim();
        searchByTag(tag);   // call our function
    });
});
