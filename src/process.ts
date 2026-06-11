interface StreamError extends Error {
  code?: string;
}

interface ErrorEventSource {
  on(event: 'error', listener: (err: StreamError) => void): unknown;
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
