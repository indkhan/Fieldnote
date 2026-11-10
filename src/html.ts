export const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export const icon = (name: string) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
// Shows a stored YYYY-MM-DD date in the reader's own short format, such as "28 Oct 2026".
export const friendlyDate = (iso: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso); return m ? new Date(+m[1], +m[2]-1, +m[3]).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : iso; };
export const logo = () => `<svg class="logo" aria-hidden="true"><use href="#i-logo"></use></svg>`;
const agentIcon = (name: string) => `<svg class="agenticon ${name}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
export const agentIcons = () => `<span class="agenticons" title="For Claude Code and Codex">${agentIcon('claude')}${agentIcon('codex')}</span>`;
