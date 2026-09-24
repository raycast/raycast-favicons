import { Observable } from "rxjs";

// Reads a fetch response body chunk by chunk, erroring once `byteLimit` is exceeded.
//
// Teardown (unsubscribe, e.g. rxjs `timeout()` or `switchMap` cancelling a slow fetch)
// cancels the reader rather than releasing its lock: on Node 22, releasing the lock
// while a read() is pending rejects that read with ERR_INVALID_STATE ("Releasing
// reader"), and with no handler attached the process exits on the unhandled rejection.
// cancel() settles the pending read cleanly and also aborts the underlying request.
// Every read() also carries a rejection handler, so a failing body errors the
// Observable instead of escaping.
export function read$(
  stream: ReadableStream<Uint8Array>,
  byteLimit: number
): Observable<Uint8Array> {
  return new Observable((observer) => {
    const reader = stream.getReader();
    let bytesReceived = 0;
    let closed = false;

    const cancel = () => {
      if (closed) {
        return;
      }
      closed = true;
      reader.cancel().catch(() => {});
    };

    const fail = (error: unknown) => {
      if (closed) {
        return;
      }
      observer.error(error);
      cancel();
    };

    function processBytes({
      done,
      value,
    }: ReadableStreamReadResult<Uint8Array>) {
      if (closed) {
        return;
      }

      if (done) {
        closed = true;
        observer.complete();
        return;
      }

      bytesReceived += value.length;
      if (bytesReceived > byteLimit) {
        fail(new Error(`Maximum size limit ${byteLimit} bytes exceeded`));
        return;
      }

      observer.next(value);
      readNext();
    }

    function readNext() {
      reader.read().then(processBytes, fail);
    }

    readNext();

    return () => cancel();
  });
}
