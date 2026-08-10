# AC-F2-6 Markdown and injection evidence

The renderer uses `react-markdown` with `skipHtml`. The focused jsdom test `src/renderer/src/markdown.test.tsx` feeds one matrix containing:

- heading, list, bold, inline code, fenced code;
- raw `<script>`;
- `<img onerror=...>`;
- a `javascript:` URL.

Assertions verify semantic Markdown elements render, no script/image node is created, the dangerous link receives no href, and the side-effect sentinel is unchanged. This deterministic renderer test covers the exact production rendering component and does not depend on model compliance with a prompt.
