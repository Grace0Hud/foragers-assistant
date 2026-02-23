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
	tag= tag.toLowerCase();

    status.text("Searching...");

    try {
        const response = await fetch(`/gallery/search?tag=${encodeURIComponent(tag)}`);

        if (!response.ok) {
            status.text("Search failed.");
            return;
        }

        const data = await response.json();

        if (!data.images || data.images.length === 0) {
            status.text(`No images found for "${data.tag}".`);
            return;
        }

        status.text(`Found ${data.images.length} image(s) for "${data.tag}".`);

        const html = data.images.map(filename => {
            return `<img src="/uploads/${encodeURIComponent(filename)}" alt="Tagged ${data.tag}">`;
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