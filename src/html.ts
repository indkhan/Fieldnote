export const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export const icon = (name: string) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
export const logo = () => `<svg class="logo" aria-hidden="true"><use href="#i-logo"></use></svg>`;
const agentIcon = (name: string) => `<svg class="agenticon ${name}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
export const agentIcons = () => `<span class="agenticons" title="For Claude Code and Codex">${agentIcon('claude')}${agentIcon('codex')}</span>`;
