const FIDELITY_STYLE = String.raw`
<style data-archive-fidelity="chatgpt-conversation">
body{font:16px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.archive-shell{max-width:48rem}
.archive-turn-content{font-size:1rem;line-height:1.5}
.archive-turn-content h1,.archive-turn-content h2,.archive-turn-content h3,.archive-turn-content h4,.archive-turn-content h5,.archive-turn-content h6{font-weight:600;letter-spacing:normal}
.archive-turn-content h1{font-size:1.5rem;line-height:2rem;margin:1.5rem 0 .5rem}
.archive-turn-content h2{font-size:1.25rem;line-height:1.75rem;margin:1rem 0 .25rem}
.archive-turn-content h3{font-size:1.125rem;line-height:1.75rem;margin:1rem 0 .25rem}
.archive-turn-content h4{font-size:1rem;line-height:1.5rem;margin:1rem 0 0}
.archive-turn-content h5,.archive-turn-content h6{font-size:1rem;line-height:1.5rem;margin:1rem 0 .25rem}
.archive-turn-content h1:first-child,.archive-turn-content h2:first-child,.archive-turn-content h3:first-child,.archive-turn-content h4:first-child{margin-top:0}
.archive-turn-content p{line-height:1.5}
.archive-turn-content pre{font-size:.875rem;line-height:1.5}
.archive-turn-content :not(pre)>code{font-size:.875em}
@media(max-width:52rem){.archive-shell{max-width:none;padding-left:18px;padding-right:18px}}
</style>`;

function stripArchiveUiArtifacts(html) {
  return String(html || '')
    .replace(/<h4(?:\s[^>]*)?>\s*(?:You said:|ChatGPT said:)\s*<\/h4>/gi, '')
    .replace(/<span(?:\s[^>]*)?>\s*Show more\s*Show less\s*<\/span>/gi, '')
    .replace(/<span class="archive-inline-label">\s*Show (?:more|less)\s*<\/span>/gi, '');
}

function consolidateDisclosureMetadata(html) {
  return String(html || '').replace(
    /<div><strong>Expansion clicks<\/strong>(\d+)<\/div><div><strong>Confirmed expansions<\/strong>(\d+)<\/div>/i,
    (match, clicksText, confirmedText) => {
      const clicks = Number(clicksText);
      const confirmed = Number(confirmedText);
      if (!Number.isFinite(clicks) || !Number.isFinite(confirmed)) return match;
      const detail = clicks === confirmed
        ? `${confirmed}`
        : `${confirmed} confirmed from ${clicks} click attempt${clicks === 1 ? '' : 's'}`;
      return `<div><strong>Disclosures expanded</strong>${detail}</div>`;
    }
  );
}

export function finalizeConversationFidelity(snapshot) {
  if (!snapshot?.html) return snapshot;
  let html = consolidateDisclosureMetadata(stripArchiveUiArtifacts(snapshot.html));
  if (!html.includes('data-archive-fidelity="chatgpt-conversation"')) {
    html = html.replace('</head>', `${FIDELITY_STYLE}</head>`);
  }
  return { ...snapshot, html };
}
