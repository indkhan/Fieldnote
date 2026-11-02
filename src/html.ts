export const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export const icon = (name: string) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
