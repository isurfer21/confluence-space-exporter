import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import dotenv from "dotenv";
import { JSDOM } from "jsdom";

dotenv.config();

const { EMAIL, API_TOKEN, BASE_URL, SPACE_KEY } = process.env;
const authHeader = "Basic " + Buffer.from(`${EMAIL}:${API_TOKEN}`).toString("base64");
const outputDir = "./confluence_pages";

// HTML template
const htmlTemplate = (title, content) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <link rel="stylesheet" href="../styles/batch.css" type="text/css">
</head>
<body class="theme-default aui-theme-default">
  <div id="page">
    <div id="main" class="aui-page-panel">
      <div id="main-header">
        <h1 id="title-heading" class="pagetitle">
          <span id="title-text">${title}</span>
        </h1>
      </div>
      <div id="content">
        <div class="pageSection">
          ${content}
        </div>
      </div>
    </div>
  </div>
</body>
</html>
`;

// Sanitize file/folder names
const sanitize = str => str.replace(/[\\/:"*?<>|]+/g, "_");

function extractFilename(url) {
  try {
    const parts = url.split('/');
    return decodeURIComponent(parts[parts.length - 1].split('?')[0]);
  } catch (e) {
    console.warn("Failed to extract filename from URL:", url);
    return "unknown.png";
  }
}

function stripImageUrl(xhtml) {
  // After fetching page content
  const dom = new JSDOM(xhtml);
  const document = dom.window.document;
  const images = document.querySelectorAll("img");
  const imageUrls = [];

  images.forEach(img => {
    const src = img.getAttribute("src");
    if (src) {
      const filename = extractFilename(src);
      img.setAttribute("src", `./${filename}`);
      imageUrls.push(src);
    }
  });

  return {
    updatedHtml: dom.serialize(),
    imageUrls
  };
}

// Fetch all pages
async function fetchPages() {
  const url = `${BASE_URL}/rest/api/content?spaceKey=${SPACE_KEY}&type=page&limit=100`;
  const res = await fetch(url, {
    headers: {
      Authorization: authHeader,
      Accept: "application/json",
    },
  });
  const data = await res.json();
  return data.results || [];
}

// Fetch page content
async function fetchPageContent(pageId) {
  const url = `${BASE_URL}/rest/api/content/${pageId}?expand=body.export_view`;
  const res = await fetch(url, {
    headers: {
      Authorization: authHeader,
      Accept: "application/json",
    },
  });
  const data = await res.json();
  return {
    title: sanitize(data.title),
    xhtml: stripImageUrl(data.body?.export_view?.value)?.updatedHtml || "",
  };
}

// Fetch attachments
async function fetchAttachments(pageId) {
  const url = `${BASE_URL}/rest/api/content/${pageId}/child/attachment`;
  const res = await fetch(url, {
    headers: {
      Authorization: authHeader,
      Accept: "application/json",
    },
  });
  const data = await res.json();
  return data.results || [];
}

// Download attachment
async function downloadAttachment(attachment, folderPath) {
  const fileName = sanitize(attachment.title);
  const downloadUrl = `${BASE_URL}${attachment._links.download}`;
  const res = await fetch(downloadUrl, {
    headers: {
      Authorization: authHeader,
    },
  });
  const buffer = await res.arrayBuffer();
  await writeFile(join(folderPath, fileName), Buffer.from(buffer));
  console.log(`📎 Downloaded: ${fileName}`);
}

// Fetch child pages
async function fetchChildren(pageId) {
  const url = `${BASE_URL}/rest/api/content/${pageId}/child/page`;
  const res = await fetch(url, {
    headers: {
      Authorization: authHeader,
      Accept: "application/json",
    },
  });
  const data = await res.json();
  return data.results || [];
}

// Build hierarchy tree
/*async function buildPageTree(pages) {
  const pageMap = new Map();

  // Initialize map and children array
  for (const page of pages) {
    page.children = [];
    pageMap.set(page.id, page);
  }

  // Fetch children and attach them properly
  for (const page of pages) {
    const children = await fetchChildren(page.id);
    for (const child of children) {
      child.children = [];
      pageMap.set(child.id, child);
      page.children.push(child);
    }
  }

  // Filter out true root pages (those not listed as children)
  const childIds = new Set();
  for (const page of pages) {
    for (const child of page.children) {
      childIds.add(child.id);
    }
  }

  const rootPages = pages.filter(page => !childIds.has(page.id));
  return rootPages;
}
*/


/**
 * Recursively builds a hierarchy tree by fetching children for each page,
 * ensuring each unique page appears only once in the final tree structure.
 *
 * @param {Array<object>} initialPages - The initial flat list of pages (e.g., from response.json).
 * @returns {Promise<Array<object>>} A promise that resolves to an array of root page objects
 *   with nested 'children' arrays representing the full hierarchy.
 */
async function buildPageTree(initialPages) {
  const pageMap = new Map(); // Stores all unique page objects by ID
  const childOfMap = new Map(); // Maps child ID to its parent ID (to identify roots)

  // 1. Populate pageMap with initial pages and initialize their children arrays
  //    Also, add them to a queue for processing.
  const queue = [];
  for (const page of initialPages) {
    if (!pageMap.has(page.id)) { // Only add if not already processed (e.g., if it was a child of something else)
      const pageCopy = { ...page, children: [] }; // Create a mutable copy
      pageMap.set(page.id, pageCopy);
      queue.push(pageCopy); // Add to queue for fetching children
    }
  }

  // 2. Process pages in a queue (BFS-like approach) to fetch children level by level
  //    This helps manage recursion depth and ensures all children are discovered.
  let head = 0;
  while (head < queue.length) {
    const currentPage = queue[head++]; // Get the next page from the queue

    // Fetch children for the current page
    // NOTE: fetchChildren function must be defined elsewhere and return an array of child page objects.
    const children = await fetchChildren(currentPage.id);

    for (const childData of children) {
      // If this child is already known, get its existing object from pageMap
      let childPage = pageMap.get(childData.id);

      if (!childPage) {
        // If child is completely new, create its object and add to map and queue
        childPage = { ...childData, children: [] };
        pageMap.set(childPage.id, childPage);
        queue.push(childPage); // Add new child to the queue to process its children later
      } else {
        // If child already exists, ensure its children array is initialized
        childPage.children = childPage.children || [];
      }

      // Add the child to the current page's children list
      // IMPORTANT: Ensure we're adding the *single instance* from pageMap
      // Also, prevent adding the same child multiple times to one parent's children array
      if (!currentPage.children.some(c => c.id === childPage.id)) {
        currentPage.children.push(childPage);
      }

      // Record that this child has a parent.
      // If a child has multiple parents, this will store the last one encountered.
      // For a strict tree, this implies a single parent.
      childOfMap.set(childPage.id, currentPage.id);
    }
  }

  // 3. Identify root pages
  const rootPages = [];
  for (const page of pageMap.values()) {
    // A page is a root if no other page has claimed it as a child
    if (!childOfMap.has(page.id)) {
      rootPages.push(page);
    }
  }

  return rootPages;
}



// Generate hierarchical HTML list
function generateHtmlList(pages) {
  let html = "<ul>";
  for (const page of pages) {
    const title = sanitize(page.title);
    const link = `./${title}/${title}.html`;
    html += `<li><a href="${link}">${page.title}</a>`;
    if (page.children && page.children.length > 0) {
      html += generateHtmlList(page.children);
    }
    html += `</li>`;
  }
  html += "</ul>";
  return html;
}

// Generate index.html
async function generateIndexHtmlHierarchical(pages) {
  const html = htmlTemplate("Content", generateHtmlList(pages));
  await writeFile(join(outputDir, "index.html"), html, "utf8");
  console.log("📄 Hierarchical index.html generated.");
}

// Main execution
(async () => {
  await mkdir(outputDir, { recursive: true });
  const flatPages = await fetchPages();

  // for (const page of flatPages) {
  //   const { title, xhtml } = await fetchPageContent(page.id);
  //   const pageDir = join(outputDir, title);
  //   await mkdir(pageDir, { recursive: true });

  //   const cleanedHtml = htmlTemplate(title, xhtml);
  //   await writeFile(join(pageDir, `${title}.html`), cleanedHtml, "utf8");
  //   console.log(`✅ Saved: ${title}.html`);

  //   // const attachments = await fetchAttachments(page.id);
  //   // for (const attachment of attachments) {
  //   //   await downloadAttachment(attachment, pageDir);
  //   // }
  // }

  const pageTree = await buildPageTree(flatPages);
  await generateIndexHtmlHierarchical(pageTree);

  console.log("🎉 All pages and hierarchical index generated.");
})();