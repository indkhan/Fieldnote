// Keep one pending write per cell; edits to different cells cannot replace each other.
export function createPropertyQueue(write, status, delay = 100) {
  const pending = new Map();
  let timer, chain = Promise.resolve();
  const flush = () => {
    clearTimeout(timer);
    chain = chain.catch(() => {}).then(async () => {
      while (pending.size) {
        const [key, entry] = pending.entries().next().value;
        status('saving');
        try { await write(entry.value); }
        catch (error) { status('error', error); throw error; }
        if (pending.get(key) === entry) pending.delete(key);
      }
      status('saved');
    });
    return chain;
  };
  return {
    enqueue(key, value) {
      pending.set(key, { value: structuredClone(value) });
      status('pending');
      clearTimeout(timer);
      timer = setTimeout(() => { flush().catch(() => {}); }, delay);
    },
    flush,
    dirty: () => pending.size > 0
  };
}
