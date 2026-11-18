// MV3 connections can disappear when Chrome suspends/reloads the worker.
// Reconnect on the next useful message, never on a timer or a disconnect loop.
export function palettePort(runtime, receive) {
  let port;
  function connect() {
    try {
      const current = runtime.connect({ name: 'palette' });
      port = current;
      current.onMessage.addListener(receive);
      current.onDisconnect.addListener(() => {
        void runtime.lastError; // Consume Chrome's expected disconnection error.
        if (port === current) port = null;
      });
      return current;
    } catch {
      port = null;
      return null;
    }
  }
  connect();
  return {
    send(message) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const current = port || connect();
        if (!current) return false;
        try {
          current.postMessage(message);
          return true;
        } catch {
          if (port === current) port = null;
        }
      }
      return false;
    },
  };
}
