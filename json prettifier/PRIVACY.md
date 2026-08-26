# Privacy Policy

**Last updated: 2026-08-27**

JSON Vision is a local-only browser extension. This policy is short because there isn't much to say.

## No data is collected

JSON Vision does not collect, log, or transmit any information about you, your browsing activity, or the content of any page you visit — including the JSON it formats.

## No analytics

There is no analytics SDK, telemetry, crash reporter, or usage tracking of any kind built into JSON Vision.

## No external requests

JSON Vision's manifest declares no remote code and makes no network requests of its own. It never calls out to an API, a CDN, or any third-party server. Every script, stylesheet, and icon it uses ships inside the extension package.

## Everything stays in your browser

All JSON parsing and rendering happens locally, inside the tab you're viewing, using only the JSON your browser already loaded. Nothing is uploaded anywhere.

## chrome.storage is only used for preferences

JSON Vision uses the `chrome.storage.local` API to remember exactly two things on your own device:

- whether the extension is enabled
- your light/dark theme preference

That's it. This data never leaves your machine, is never sent to us or anyone else, and is fully under your control — you can clear it at any time by removing the extension.

## Permissions

JSON Vision requests the minimum permissions needed to do its job:

- **`storage`** — to remember your preferences, as described above.
- **Host access to `http`, `https`, and `file` pages** — so it can detect when a page you open is a raw JSON document and offer to format it. It only acts on pages whose content type is JSON; it does not read, modify, or transmit any other page content.

## Questions

If you have questions about this policy, please open an issue on the [GitHub repository](https://github.com/your-username/json-vision/issues).
