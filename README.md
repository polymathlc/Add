# Add for CER

A plain, responsive website for uploading science PDFs to CER's durable import worker and reviewing the same administrator vetting list. No build step, application server or provider API keys in the browser.

Deploy this repository with GitHub Pages (Settings → Pages → Source: GitHub Actions). The included workflow checks the code, exercises the production UI with Firebase mocked, and publishes only the static website. The repository's canonical Pages URL is **https://polymathlc.github.io/Add/**; path casing follows the repository name. `config.js` points exported preview at **https://polymathlc.github.io/cer/**. Host both under the same origin: CER's preview bridge deliberately rejects other origins. The `/app` landing site can link or redirect here.

## Required CER service

Deploy the `cer-rapid-import` Firebase codebase from `polymathlc/cer` to the existing `mathgen--app` project. Follow [CER's deployment instructions](https://github.com/polymathlc/cer/blob/main/rapid-import/README.md). Publishing this website does not deploy that worker. Sign-in uses the existing Firebase project; the backend enforces administrator claims / verified administrator email. The Pages domain must be present in Firebase Authentication's authorised domains for Google sign-in. No rules are changed here.

The website enables uploads only after authenticated `rapidImportStatus` returns `available:true`. Its returned capabilities enable image editing and distinguish the newer automatic-enhancement worker from an older deployment. A disconnected or missing worker is shown explicitly. It does not substitute a browser-only importer.

Each PDF is limited to 40 MB / 60 pages. Files are uploaded in 3 MiB chunks through `rapidImportBegin`, `rapidImportChunk` and `rapidImportFinish`. The page must remain open until **Stored online — safe to close**. Only a successful final server acknowledgement produces that message. After that, the server continues extraction, figure cropping, automatic checking and repair even when the whole browser is closed. Content hashes retain a per-account resume ID in browser storage: selecting the same PDF again resumes the same import without creating another copy. Failed worker tasks can be retried from Paper progress. Originals and recoverable upload data follow CER's retention policy.

The list subscribes to `users/{current uid}/vetting`; approved or removed items disappear and edits arrive live. It matches CER's loader by ignoring documents without a stored question ID; CER deletes removed questions rather than keeping binned records in that collection. CER's custom topic settings are read from the same owner's `settings/topics` document. Every new upload requests automatic checking. Green means a completed clean check whose full content signature still matches, yellow means remaining review findings, red means a failed check or serious finding. Missing, older-audit and stale checks are never green: stale checks show **Check out of date** and need a new CER check. Figure, answer-key or wording edits invalidate the signature, including edits after its stored text prefix. The tool keeps questions in Vetting for final approval and cannot guarantee AI extraction or corrections are error-free.

Figure tools call `rapidVettingImage` with the question ID, block ID and expected current URL. Resize also includes the previous scale to detect competing edits. Colour / clean B&W always start from the preserved original crop, and Restore original returns to it. Tables, flowcharts and graphs remain monochrome. Server errors leave the existing figure visible. Original crop and source-page links remain accessible. Keep the page open for confirmation when editing a figure; an interrupted response may require refreshing to confirm the server result.

**Preview all** uses CER's existing exported worksheet renderer inside an iframe, with the currently filtered IDs (up to 500). It shares CER's pagination, answer layout, image resizing and regeneration tools rather than approximating the exported worksheet. CER v1.422.0 or newer must be deployed for the bridge. Preview messages check both origin and sender; the close handshake flushes edits before hiding the frame. The iframe remains mounted while hidden. On a local development origin, CER intentionally rejects the bridge; the browser tests use an isolated fixture.

## Checks

```sh
npm run check
npm test
npm install --no-save --package-lock=false playwright@1.58.2
npx playwright install chromium
node tests/browser.mjs
```

The core tests exercise upload acknowledgement, byte-perfect chunk transfer, resumability, retry permissions, account changes, quality states and topic selection. Browser tests execute the production HTML/CSS/modules with mocked Firebase edges, covering unavailable service, sign-in, synced list, safe rich text, uploads, image tools, filters, preview handshakes and mobile layout. Set `PLAYWRIGHT_MODULE` and `BROWSER_EXECUTABLE` to use an existing local runtime. Screenshots are saved to ignored `test-results/`.

Live acceptance still requires an authorised administrator: upload a small multi-page paper, wait for Stored online, close the browser, reopen and verify all questions, figures and traffic lights in CER. Exercise colour, B&W, restore and resizing in both websites; verify a failed import retries without duplicate questions. Mocked tests do not establish deployed IAM, AI provider availability, billing or production data permissions.
