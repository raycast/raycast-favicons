import { Observable } from "rxjs";

export function read$(
  stream: ReadableStream<Uint8Array>,
  byteLimit: number
): Observable<Uint8Array> {
  return new Observable((observer) => {
    const reader = stream.getReader();
    let bytesReceived = 0;
    let closed = false;

    const releaseLock = () => {
      closed = true;
      reader.releaseLock();
    };

    const read = (): Promise<ReadableStreamReadResult<Uint8Array>> => {
      if (closed) {
        return new Promise((resolve) =>
          resolve({ done: true, value: undefined })
        );
      } else {
        return reader.read();
      }
    };

    function processBytes({
      done,
      value,
    }: ReadableStreamReadResult<Uint8Array>) {
      if (done) {
        observer.complete();
        return;
      }

      bytesReceived += value.length;
      if (bytesReceived > byteLimit) {
        observer.error(
          new Error(`Maximum size limit ${byteLimit} bytes exceeded`)
        );
        return;
      }

      observer.next(value);
      read().then(processBytes);
    }

    read().then(processBytes);

    return () => releaseLock();
  });
}
