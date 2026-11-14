import { TaskRuntime } from './task-runtime.ts';
import { executeTaskQuery } from './task-queries.ts';

/** IPC ordering and process recycling; business handlers live outside the transport. */
export function serveTasks(root: string) {
  const runtime = new TaskRuntime(root);
  let stopping = false,
    queue = Promise.resolve();
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await runtime.close();
    if (process.connected) process.disconnect();
  };
  process.on('message', (message: any) => {
    if (message?.type === 'stop') {
      queue = queue.then(stop);
      return;
    }
    if (message?.type !== 'run' || stopping) return;
    queue = queue.then(async () => {
      try {
        // ESM caches transitive modules; replace the process instead of partly reloading an extension.
        if (await runtime.changed()) {
          process.send?.({ type: 'recycle', id: message.id });
          await stop();
          return;
        }
        const value = await executeTaskQuery(runtime, message.operation, message.payload);
        if (process.connected) process.send!({ type: 'result', id: message.id, value });
      } catch (error: any) {
        if (process.connected)
          process.send!({
            type: 'result',
            id: message.id,
            error: { message: error.message, status: error.status ?? 500, details: error.details },
          });
      }
    });
  });
  process.once('disconnect', () => {
    void queue.then(stop);
  });
  process.send?.({ type: 'ready' });
}
