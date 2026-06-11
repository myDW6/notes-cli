interface StreamError extends Error {
  code?: string;
}

interface ErrorEventSource {
  on(event: 'error', listener: (err: StreamError) => void): unknown;
}

interface SignalEventSource {
  on(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
  off(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
}

export function installBrokenPipeHandler(
  stream: ErrorEventSource = process.stdout,
  exit: (code: number) => void = process.exit,
): void {
  stream.on('error', (err: StreamError) => {
    if (err.code === 'EPIPE') {
      exit(0);
      return;
    }
    throw err;
  });
}

export function installSignalHandlers(
  cancellation: {
    cancelForSignal(signal: 'SIGINT' | 'SIGTERM'): void;
  },
  source: SignalEventSource = process,
): () => void {
  const onSigint = () => cancellation.cancelForSignal('SIGINT');
  const onSigterm = () => cancellation.cancelForSignal('SIGTERM');
  source.on('SIGINT', onSigint);
  source.on('SIGTERM', onSigterm);
  return () => {
    source.off('SIGINT', onSigint);
    source.off('SIGTERM', onSigterm);
  };
}
