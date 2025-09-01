# confluence-space-exporter

It exports all the pages from given Confluence Space in HTML format.

### 📁 Prepare `.env` File 

Please create a `.env` file in the project directory with the following content:

```env
EMAIL=your_email@example.com
API_TOKEN=your_api_token
BASE_URL=https://your_subdomain.atlassian.net/wiki
SPACE_KEY=your_space_id
```

Make sure to replace the placeholder values with your actual credentials, subdomain and space key.

### 🚀 How to Run?

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.js
```

This project was created using `bun init` in bun v1.2.16. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.

### 📦 What the Program Does?

Once the `.env` file is correctly set up, on execution, the script will:

1. **Fetch all pages** in the specified Confluence space.
2. **Download each page's HTML content**.
3. **Apply an HTML template** with styles to render the content.
4. **Save each page as an HTML file** in a folder named after the page.
5. **Download all attachments** for each page into the same folder.
6. **Generate content list** as index file.

