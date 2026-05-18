---
title: Attaching files
description: Upload and attach files to your chat messages for the model to read.
---

# Attaching files

You can attach images and text-based files to any message. The model receives the file content alongside your prompt and can read, analyse, or reference it in its response.

> [SCREENSHOT: Composer with an attached image thumbnail and a text file chip visible above the text area]

## What you see

When you add an attachment, a preview chip appears above the composer text area. Image files show a small thumbnail. Text and code files show a filename chip. You can attach multiple files to a single message. Click the **X** on a chip to remove an attachment before sending.

## How to attach a file

**File picker** — Click the paperclip icon in the composer. Your browser's file picker opens. Select one or more files.

**Drag and drop** — Drag a file from your desktop or file manager onto the composer area. The composer highlights when a drag is detected. Drop to attach.

## Supported file types

**Images** — PNG, JPEG, GIF, WebP, BMP, SVG, AVIF, HEIC, HEIF, TIFF. Large images are automatically resized to a maximum of 1920 px on the longest side and compressed to JPEG at 85% quality before sending to keep the payload within transport limits (1 MB per image after processing).

**Text and code** — Markdown (`.md`), plain text (`.txt`), JSON (`.json`), CSV (`.csv`), TypeScript (`.ts`, `.tsx`), JavaScript (`.js`), Python (`.py`). The file content is read as UTF-8 text and included in the message body.

The maximum file size you can select is **50 MB**. After processing, images must be under 1 MB; text files are included as-is within that size budget.

## How attachments are sent

Image attachments are base64-encoded and sent to the agent as image content blocks. Text and code files are base64-encoded with a `data:text/...;base64,` prefix so the server can reconstruct a valid data URI. The agent decodes the content and presents it to the model as part of the message.

Because attachments are embedded directly in the message, they consume context window tokens proportional to their content size. Large text files will use a significant portion of the context window.

## Common issues

**File is accepted but the model does not seem to see it** — Very large text files may be truncated by the model's context limit. Try splitting the file or pasting only the relevant portion.

**Image appears blurry in the response** — The automatic resize targets 1920 px at 85% JPEG quality. If precise pixel-level detail matters, consider pasting a cropped region instead.

**Unsupported file type** — Binary files (PDF, Word, Excel, etc.) are not currently supported for direct attachment. Copy and paste the relevant text content instead. PDF support is planned.

## Related

- [The composer](./composer.md)
- [Context window indicator](./context-window.md)
