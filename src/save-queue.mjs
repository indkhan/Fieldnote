// Serialize writes so an older autosave can never overwrite a newer edit.
export function createSaveQueue(write, status, delay = 350) {
  let pending = null, timer, chain = Promise.resolve();
  const flush = () => {
    clearTimeout(timer);
    const operation = chain.catch(() => {}).then(async () => {
      while (pending !== null) {
        const value = pending;
        pending = null;
        status('saving');
        try { await write(value); }
        catch (error) {
          if (pending === null) pending = value;
          status('error', error);
          throw error;
        }
      }
      status('saved');
    });
    chain = operation;
    return operation;
  };
  return {
    enqueue(value) {
      pending = structuredClone(value);
      status('pending');
      clearTimeout(timer);
      timer = setTimeout(() => { flush().catch(() => {}); }, delay);
    },
    flush,
    dirty: () => pending !== null
  };
}
